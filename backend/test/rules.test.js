// Tests that the page and the backend agree on limits and fees, that "this month"
// follows Finnish time, and that an enquiry email is retried. Run with: npm test
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from '../src/index.js';
import { CURRENCIES, feeCents, monthStartSeconds } from '../src/rules.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// The page's settings, loaded the way a browser would load config.js.
function pageConfig() {
  const window = {};
  vm.runInNewContext(read('../../site/config.js'), { window, location: { protocol: 'https:', hostname: 'give.koivikko.org' } });
  return JSON.parse(JSON.stringify(window.KOIVIKKO_CONFIG)); // plain copies, comparable in tests
}
// Every FEE_PERCENT in wrangler.toml (sandbox and production).
const feePercents = () => [...read('../wrangler.toml').matchAll(/^FEE_PERCENT\s*=\s*"([^"]+)"/gm)].map((m) => Number(m[1]));

test('the page and the backend allow the same currencies and amounts', () => {
  const page = pageConfig();
  assert.deepEqual([...page.currencies].sort(), Object.keys(CURRENCIES).map((c) => c.toUpperCase()).sort());
  for (const [code, { min, max }] of Object.entries(CURRENCIES)) {
    assert.deepEqual(page.limits[code.toUpperCase()], [min, max], code);
  }
});

test('the page and the backend use the same fee percentage', () => {
  const percents = feePercents();
  assert.equal(percents.length, 2, 'sandbox and production');
  for (const p of percents) assert.equal(p, Math.round(pageConfig().coverFeesRate * 10000) / 100);
});

test('the page works out the same fee as the backend for every amount', () => {
  const CFG = pageConfig();
  const source = read('../../site/app.js').match(/\/\/ fee-rule:start[^\n]*\n([\s\S]*?)\/\/ fee-rule:end/);
  assert.ok(source, 'the fee rule is still marked in app.js');
  const feeFor = vm.runInNewContext(`${source[1]}; feeFor`, { CFG, Math });
  const percent = feePercents()[0];

  assert.equal(feeCents(2250, 3), 70); // 22.50 at 3% lands exactly between 0.65 and 0.70
  assert.equal(feeCents(200, 3), 30); // the minimum
  for (let cents = 200; cents <= 1500000; cents += cents < 300000 ? 1 : 997) {
    const page = Math.round(feeFor(cents / 100) * 100);
    if (page !== feeCents(cents, percent)) assert.fail(`fee for ${cents / 100}: page ${page}, backend ${feeCents(cents, percent)}`);
  }
});

test('"this month" starts at midnight in Finland, in winter and summer time', () => {
  const start = (iso) => new Date(monthStartSeconds(new Date(iso)) * 1000).toISOString();
  assert.equal(start('2026-11-19T10:00:00Z'), '2026-10-31T22:00:00.000Z'); // winter, UTC+2
  assert.equal(start('2026-10-31T22:30:00Z'), '2026-10-31T22:00:00.000Z'); // already November in Finland
  assert.equal(start('2026-10-31T21:30:00Z'), '2026-09-30T21:00:00.000Z'); // still October in Finland
  assert.equal(start('2026-10-30T12:00:00Z'), '2026-09-30T21:00:00.000Z'); // clocks changed during the month
  assert.equal(start('2026-07-15T12:00:00Z'), '2026-06-30T21:00:00.000Z'); // summer, UTC+3
});

// ---------------------------------------------------------------- enquiry email

const realFetch = globalThis.fetch;
const realError = console.error;
afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

const env = {
  ENVIRONMENT: 'sandbox',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  RESEND_API_KEY: 're_test',
  CONTACT_TO_EMAIL: 'to@example.com',
  CONTACT_FROM_EMAIL: 'from@example.com',
};
// Sends an enquiry while the email service answers with the given statuses in turn
// (0 = cannot be reached). Returns the Worker's answer and the keys sent with each try.
async function enquire(statuses) {
  const keys = [];
  console.error = () => {};
  globalThis.fetch = async (url, init) => {
    keys.push(init.headers['Idempotency-Key']);
    const status = statuses[keys.length - 1];
    if (!status) throw new TypeError('network down');
    return new Response('{}', { status });
  };
  const res = await worker.fetch(
    new Request('https://api.example/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ name: 'Real Person', email: 'real@example.com', message: 'Hello' }),
    }),
    env,
    { waitUntil() {} },
  );
  return { status: res.status, data: await res.json(), keys };
}

test('an enquiry email that fails once is sent again, with the same key', async () => {
  const r = await enquire([500, 200]);
  assert.deepEqual(r.data, { ok: true });
  assert.equal(r.keys.length, 2);
  assert.ok(r.keys[0] && r.keys[0] === r.keys[1]);
});

test('an unreachable email service is tried twice, then reported to the visitor', async () => {
  const r = await enquire([0, 0]);
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'email_failed');
  assert.equal(r.keys.length, 2);
});

test('an email the service refuses outright is not sent again', async () => {
  const r = await enquire([422, 200]);
  assert.equal(r.data.error, 'email_failed');
  assert.equal(r.keys.length, 1);
});
