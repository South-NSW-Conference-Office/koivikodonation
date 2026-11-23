// Tests for what the counter and the pop-ups include. Run with: npm test
// Stripe is faked: each test says which subscriptions, payments, refunds and disputes exist.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const NOW = Math.floor(Date.now() / 1000);
const SOURCE = { source: 'koivikko-donate' };

const baseEnv = {
  ENVIRONMENT: 'sandbox',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
  FX_TO_EUR: '{"eur":1,"aud":0.6,"usd":0.9}',
  SUPPORTER_GOAL: '100',
  CACHE: { get: async () => null, put: async () => {} },
};
const ctx = { waitUntil() {} };

const realFetch = globalThis.fetch;
const realError = console.error;
afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

const list = (data) => ({ object: 'list', data, has_more: false });

// Builds the counter from the given Stripe contents and returns { stats, recent }.
let run = 0;
// `ecb` is the text of the central bank's rates file; without it the bank is "down"
// and the fallback rates in FX_TO_EUR are used.
async function summary({ subscriptions = [], sessions = [], refunds = [], disputes = [], ecb = null }, env = baseEnv) {
  if (console.error === realError) console.error = () => {}; // keep expected failures out of the test output
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (url.includes('ecb.europa.eu')) return new Response(ecb || '', { status: ecb ? 200 : 503 });
    let body;
    if (url.includes('/v1/subscriptions')) {
      const status = new URL(url).searchParams.get('status');
      body = list(subscriptions.filter((x) => x.status === status));
    }
    else if (url.includes('/v1/checkout/sessions')) body = list(sessions);
    else if (url.includes('/v1/refunds')) body = list(refunds);
    else if (url.includes('/v1/disputes')) body = list(disputes);
    else throw new Error('unexpected outside call: ' + url);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  // A fresh copy of the Worker each time, so one test's saved numbers never reach the next.
  const { default: worker } = await import(`../src/index.js?run=${++run}`);
  const get = async (path) => {
    const res = await worker.fetch(new Request('https://api.example' + path), env, ctx);
    assert.equal(res.status, 200, path);
    return res.json();
  };
  return { stats: await get('/stats'), recent: (await get('/recent')).items };
}

const sub = (id, { gift, fee = 0, price = gift + fee, currency = 'eur', quantity = 1, interval = 'month', ...rest } = {}) => ({
  id,
  object: 'subscription',
  status: 'active',
  currency,
  pause_collection: null,
  metadata: { ...SOURCE, gift_amount: String(gift), fee_amount: String(fee) },
  customer: { id: 'cus_' + id, email: id + '@example.com' },
  items: { data: [{ quantity, price: { unit_amount: price, recurring: { interval, interval_count: 1 } } }] },
  ...rest,
});

const oneTime = (id, { gift, fee = 0, currency = 'eur', ...rest } = {}) => ({
  id: 'cs_test_' + id,
  object: 'checkout.session',
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  created: NOW - 60,
  currency,
  amount_total: gift + fee,
  payment_intent: 'pi_' + id,
  subscription: null,
  customer_details: { address: { country: 'FI' } },
  metadata: { ...SOURCE, gift_amount: String(gift), fee_amount: String(fee), show_country: 'true' },
  ...rest,
});

test('a monthly gift counts the gift without the card fee', async () => {
  const { stats } = await summary({ subscriptions: [sub('sub_1', { gift: 4000, fee: 120 })] });
  assert.equal(stats.activeMonthlyDonors, 1);
  assert.equal(stats.monthlyPledgedTotal, 40);
});

test('an amount changed in the Stripe dashboard is counted at its new amount', async () => {
  const { stats } = await summary({ subscriptions: [sub('sub_1', { gift: 4000, fee: 120, price: 7500 })] });
  assert.equal(stats.monthlyPledgedTotal, 75);
});

test('a gift changed to yearly is counted per month', async () => {
  const { stats } = await summary({ subscriptions: [sub('sub_1', { gift: 4000, price: 24000, interval: 'year' })] });
  assert.equal(stats.monthlyPledgedTotal, 20);
});

test('a paused monthly gift is not counted and leaves the pop-ups', async () => {
  const { stats, recent } = await summary({
    subscriptions: [
      sub('sub_active', { gift: 2500 }),
      sub('sub_paused', { gift: 5000, pause_collection: { behavior: 'void' } }),
    ],
    sessions: [
      oneTime('a', { gift: 2500, mode: 'subscription', subscription: 'sub_active', payment_intent: null }),
      oneTime('b', { gift: 5000, mode: 'subscription', subscription: 'sub_paused', payment_intent: null }),
    ],
  });
  assert.equal(stats.activeMonthlyDonors, 1);
  assert.equal(stats.monthlyPledgedTotal, 25);
  assert.deepEqual(recent.map((r) => r.amount), [25]);
});

test('a fully refunded one-time gift leaves the total and the pop-ups', async () => {
  const { stats, recent } = await summary({
    sessions: [oneTime('kept', { gift: 1000 }), oneTime('back', { gift: 5000, fee: 150 })],
    refunds: [{ payment_intent: 'pi_back', amount: 5150, status: 'succeeded' }],
  });
  assert.equal(stats.oneTimeThisMonth, 10);
  assert.deepEqual(recent.map((r) => r.amount), [10]);
});

test('a part refund counts the part that was kept; a failed refund changes nothing', async () => {
  const { stats, recent } = await summary({
    sessions: [oneTime('half', { gift: 4000 }), oneTime('whole', { gift: 1000 })],
    refunds: [
      { payment_intent: 'pi_half', amount: 2000, status: 'succeeded' },
      { payment_intent: 'pi_whole', amount: 1000, status: 'failed' },
    ],
  });
  assert.equal(stats.oneTimeThisMonth, 30);
  assert.equal(recent.length, 2);
});

test('a disputed one-time gift is dropped unless the dispute was won', async () => {
  const { stats } = await summary({
    sessions: [oneTime('open', { gift: 3000 }), oneTime('won', { gift: 2000 })],
    disputes: [
      { payment_intent: 'pi_open', status: 'needs_response' },
      { payment_intent: 'pi_won', status: 'won' },
    ],
  });
  assert.equal(stats.oneTimeThisMonth, 20);
});

test('a missing exchange rate leaves that gift out instead of stopping the counter', async () => {
  const logged = [];
  console.error = (line) => logged.push(line);
  const env = { ...baseEnv, FX_TO_EUR: '{"eur":1,"usd":0.9}' };
  const { stats } = await summary({
    subscriptions: [sub('sub_eur', { gift: 2000 }), sub('sub_aud', { gift: 4000, currency: 'aud' })],
    sessions: [oneTime('usd', { gift: 1000, currency: 'usd' }), oneTime('aud', { gift: 9000, currency: 'aud' })],
  }, env);
  assert.equal(stats.activeMonthlyDonors, 2); // the person still counts
  assert.equal(stats.monthlyPledgedTotal, 20);
  assert.equal(stats.oneTimeThisMonth, 9);
  assert.equal(logged.filter((l) => l.includes('No EUR rate for aud')).length, 1, 'logged once');
});

test('a gift whose card failed still counts while Stripe is retrying it', async () => {
  const { stats } = await summary({
    subscriptions: [
      sub('sub_ok', { gift: 2000 }),
      sub('sub_retrying', { gift: 3000, status: 'past_due' }),
      sub('sub_gone', { gift: 9000, status: 'canceled' }),
    ],
  });
  assert.equal(stats.activeMonthlyDonors, 2);
  assert.equal(stats.monthlyPledgedTotal, 50);
});

test('one person with two monthly gifts counts once, with both amounts', async () => {
  const same = { id: 'cus_x', email: 'Same.Person@example.com' };
  const { stats } = await summary({
    subscriptions: [
      sub('sub_1', { gift: 2000, customer: same }),
      sub('sub_2', { gift: 1500, customer: { id: 'cus_y', email: 'same.person@example.com' } }),
      sub('sub_3', { gift: 1000 }),
    ],
  });
  assert.equal(stats.activeMonthlyDonors, 2);
  assert.equal(stats.monthlyPledgedTotal, 45);
});

test('the pop-up shows the country the donor chose, not the card country', async () => {
  const chosen = oneTime('a', { gift: 2000 });
  chosen.metadata.donor_country = 'AU';
  const hidden = oneTime('b', { gift: 3000 });
  hidden.metadata.show_country = 'false';
  hidden.metadata.donor_country = 'AU';
  const { recent } = await summary({ sessions: [chosen, hidden, oneTime('older', { gift: 1000 })] });
  assert.deepEqual(recent.map((r) => r.country), ['AU', null, 'FI']); // the last one was made before the choice was stored
});

test('a large gift never names its country', async () => {
  const big = oneTime('big', { gift: 25000 });
  big.metadata.donor_country = 'MT';
  const { recent } = await summary({ sessions: [big, oneTime('small', { gift: 24900 })] });
  assert.deepEqual(recent.map((r) => [r.amount, r.country]), [[250, null], [249, 'FI']]);
});

test('the central bank rates are used when they can be fetched', async () => {
  const ecb = "<Cube time='2026-11-18'><Cube currency='USD' rate='1.25'/><Cube currency='AUD' rate='2'/></Cube>";
  const { stats } = await summary({ subscriptions: [sub('sub_1', { gift: 10000, currency: 'usd' }), sub('sub_2', { gift: 10000, currency: 'aud' })], ecb });
  assert.equal(stats.monthlyPledgedTotal, 130); // 100 USD = 80 EUR, 100 AUD = 50 EUR
});

test('the fallback rates are used when the central bank cannot be reached', async () => {
  const { stats } = await summary({ subscriptions: [sub('sub_1', { gift: 10000, currency: 'usd' })] });
  assert.equal(stats.monthlyPledgedTotal, 90);
});

test('a rates file missing a currency is refused, and the fallback is used', async () => {
  const ecb = "<Cube currency='USD' rate='1.25'/>";
  const { stats } = await summary({ subscriptions: [sub('sub_1', { gift: 10000, currency: 'usd' })], ecb });
  assert.equal(stats.monthlyPledgedTotal, 90);
});

test('the counter is shown in COUNTER_CURRENCY, at the central bank rate', async () => {
  const ecb = "<Cube time='2026-11-18'><Cube currency='USD' rate='1.25'/><Cube currency='AUD' rate='2'/></Cube>";
  const env = { ...baseEnv, COUNTER_CURRENCY: 'AUD' };
  const { stats } = await summary({
    subscriptions: [sub('sub_eur', { gift: 5000 }), sub('sub_aud', { gift: 4000, currency: 'aud' })],
    sessions: [oneTime('once', { gift: 1000, currency: 'usd' })],
    ecb,
  }, env);
  assert.equal(stats.currency, 'AUD');
  assert.equal(stats.monthlyPledgedTotal, 140); // 50 EUR = 100 AUD, plus 40 AUD (no round trip loss)
  assert.equal(stats.oneTimeThisMonth, 16); // 10 USD = 8 EUR = 16 AUD
  assert.equal(stats.combinedThisMonth, 156);
});

test('without a rate for COUNTER_CURRENCY the counter stays in EUR', async () => {
  const env = { ...baseEnv, COUNTER_CURRENCY: 'GBP' };
  const { stats } = await summary({ subscriptions: [sub('sub_1', { gift: 2000 })] }, env);
  assert.equal(stats.currency, 'EUR');
  assert.equal(stats.monthlyPledgedTotal, 20);
});

test('the feed gives "minutes ago", never the exact time', async () => {
  const { recent } = await summary({ sessions: [oneTime('a', { gift: 1000 })] });
  assert.equal(recent.length, 1);
  assert.equal('createdAt' in recent[0], false);
  assert.ok(recent[0].minutesAgo >= 1);
});
