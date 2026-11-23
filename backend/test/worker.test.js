// Tests for the edge cases fixed in the Worker. Run with: npm test
// Nothing here talks to Stripe or any other service: outside calls are faked.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

const ORIGIN = 'http://localhost:3000';
const LOGIN_URL = 'https://billing.stripe.com/p/login/test_example';
const env = {
  ENVIRONMENT: 'sandbox',
  ALLOWED_ORIGINS: `${ORIGIN},http://127.0.0.1:3000`,
  STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
  SUCCESS_URL: 'http://localhost:3000/thank-you.html',
  CANCEL_URL: 'http://localhost:3000/donate-cancelled.html',
  PORTAL_LOGIN_URL: LOGIN_URL,
  FEE_PERCENT: '3',
};
const ctx = { waitUntil() {} };

async function call(path, body, origin = ORIGIN) {
  const res = await worker.fetch(
    new Request('https://api.example' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
    ctx,
  );
  return { status: res.status, data: await res.json() };
}

// Replace outside calls with canned answers; records which addresses were asked for.
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function fakeOutside(answers) {
  const asked = [];
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    asked.push(url);
    const match = Object.keys(answers).find((part) => url.includes(part));
    if (!match) throw new Error('unexpected outside call: ' + url);
    return new Response(JSON.stringify(answers[match]), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_test' },
    });
  };
  return asked;
}
const noOutsideCalls = () => fakeOutside({});

test('a body over the size cap is refused as too large, not as a bad currency', async () => {
  noOutsideCalls();
  const big = JSON.stringify({ currency: 'EUR', giftAmount: 10, note: 'x'.repeat(10001) });
  for (const path of ['/checkout', '/contact', '/portal']) {
    const r = await call(path, big);
    assert.equal(r.status, 413, path);
    assert.equal(r.data.error, 'too_large', path);
  }
});

test('unreadable JSON is still treated as an empty request', async () => {
  noOutsideCalls();
  const r = await call('/checkout', '{not json');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'invalid_currency');
});

test('a filled honeypot field is quietly dropped', async () => {
  noOutsideCalls(); // no email may be sent
  const r = await call('/contact', { name: 'Bot', email: 'bot@example.com', leaveBlank: 'x' });
  assert.deepEqual(r, { status: 200, data: { ok: true } });
});

test('an autofilled "company" value no longer drops a real enquiry', async () => {
  const asked = fakeOutside({ 'api.resend.com': { id: 'email_1' } });
  const withEmail = { ...env, RESEND_API_KEY: 're_test', CONTACT_TO_EMAIL: 'to@example.com', CONTACT_FROM_EMAIL: 'from@example.com' };
  const res = await worker.fetch(
    new Request('https://api.example/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ name: 'Real Person', email: 'real@example.com', company: 'Autofilled Pty Ltd' }),
    }),
    withEmail,
    ctx,
  );
  assert.equal(res.status, 200);
  assert.equal(asked.length, 1, 'the enquiry email was sent');
});

test('write endpoints accept the local page on both localhost and 127.0.0.1', async () => {
  noOutsideCalls();
  for (const origin of [ORIGIN, 'http://127.0.0.1:3000']) {
    const r = await call('/checkout', { currency: 'XXX' }, origin);
    assert.equal(r.data.error, 'invalid_currency', origin); // got past the origin check
  }
  const stranger = await call('/checkout', { currency: 'EUR', giftAmount: 10 }, 'https://evil.example');
  assert.equal(stranger.status, 403);
});

test('wrangler.toml lists 127.0.0.1:3000 for the sandbox', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const sandboxLine = toml.split('\n').find((l) => l.startsWith('ALLOWED_ORIGINS'));
  assert.match(sandboxLine, /http:\/\/127\.0\.0\.1:3000/);
});

const sessionMade = (secondsAgo) => ({
  id: 'cs_test_abc123',
  object: 'checkout.session',
  created: Math.floor(Date.now() / 1000) - secondsAgo,
  mode: 'subscription',
  customer: 'cus_test_1',
  metadata: { source: 'koivikko-donate' },
});

test('a thank-you id older than an hour only gets the portal login page', async () => {
  const asked = fakeOutside({ '/v1/checkout/sessions/': sessionMade(2 * 3600) });
  const r = await call('/portal', { sessionId: 'cs_test_abc123' });
  assert.deepEqual(r.data, { url: LOGIN_URL, direct: false });
  assert.ok(!asked.some((u) => u.includes('billing_portal')), 'no direct portal link was made');
});

test('a thank-you id from the last hour opens the portal directly', async () => {
  fakeOutside({
    '/v1/checkout/sessions/': sessionMade(600),
    '/v1/billing_portal/sessions': { id: 'bps_1', url: 'https://billing.stripe.com/p/session/test_1' },
  });
  const r = await call('/portal', { sessionId: 'cs_test_abc123' });
  assert.deepEqual(r.data, { url: 'https://billing.stripe.com/p/session/test_1', direct: true });
});

test('a one-time gift id never opens the portal directly', async () => {
  fakeOutside({ '/v1/checkout/sessions/': { ...sessionMade(600), mode: 'payment' } });
  const r = await call('/portal', { sessionId: 'cs_test_abc123' });
  assert.equal(r.data.direct, false);
});

// Starts a gift and returns what was stored on it in Stripe.
async function storedOnGift(body) {
  let sent = '';
  globalThis.fetch = async (input, init) => {
    sent = String(init?.body ?? (await input.text?.()) ?? '');
    return new Response(JSON.stringify({ id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/cs_test_new' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const r = await call('/checkout', { giftAmount: 25, currency: 'EUR', frequency: 'monthly', ...body });
  assert.equal(r.status, 200);
  const form = new URLSearchParams(sent);
  return { show: form.get('metadata[show_country]'), country: form.get('metadata[donor_country]') };
}

test('the country is shown only when the donor ticked the box', async () => {
  assert.deepEqual(await storedOnGift({ donorCountry: 'AU' }), { show: 'false', country: null });
  assert.deepEqual(await storedOnGift({ donorCountry: 'AU', showCountry: false }), { show: 'false', country: null });
  assert.deepEqual(await storedOnGift({ donorCountry: 'au', showCountry: true }), { show: 'true', country: 'AU' });
  assert.deepEqual(await storedOnGift({ donorCountry: 'Australia', showCountry: true }), { show: 'true', country: null });
});
