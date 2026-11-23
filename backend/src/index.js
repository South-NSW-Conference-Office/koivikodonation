// Koivikko donation backend - Cloudflare Worker.
//
//   POST /checkout        create a Stripe Checkout Session (monthly or one-time)
//   GET  /stats           counter: active monthly donors + totals, in COUNTER_CURRENCY (AUD)
//   GET  /recent          anonymous "just pledged" feed (country, amount, frequency)
//   GET  /session?session_id=  amount + frequency for the thank-you page
//   POST /portal          link to Stripe's customer portal (cancel / update card)
//   POST /contact         Australian family-trust enquiry -> email
//   POST /stripe-webhook  Stripe events -> refresh the cached counter
//
// Stripe is the source of truth. Nothing personal is stored here: the only
// thing kept is a cached, anonymous summary in KV for a few minutes.

import Stripe from 'stripe';
import { CURRENCIES, feeCents, monthStartSeconds, parseEcbRates } from './rules.js';

// Marks everything this page creates, so other activity in the Foundation's
// Stripe account is never counted.
const SOURCE = 'koivikko-donate';

// Gift limits and the card-fee rule live in rules.js.

// The counter and feed are served from a saved copy, so visitors never wait on
// Stripe and a Stripe outage never blanks the page.
const CACHE_KEY = 'summary-v3';
const FRESH_SECONDS = 300; // older than this: serve it, and refresh in the background
const REBUILD_GAP_SECONDS = 15; // after a gift, refresh at most this often
const KEEP_SECONDS = 86400; // how long the last good copy is kept if Stripe cannot be reached
const MEMO_SECONDS = 10; // each running copy of this Worker re-reads the saved copy this often
// Calls to Stripe and other services give up after this long instead of hanging.
const STRIPE_TIMEOUT_MS = 8000;
const STRIPE_RETRIES = 2;
const OUTBOUND_TIMEOUT_MS = 8000;
const ATTEMPT_ID_RE = /^[A-Za-z0-9-]{16,64}$/;
const RECENT_DAYS = 30;
const RECENT_LIMIT = 10;
const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;
// How long after donating the thank-you page may open the portal directly.
// Kept short: the id in the thank-you address works as a key to that donor's gift.
const PORTAL_DIRECT_SECONDS = 3600;

// Rate limits: which limiter (see wrangler.toml) guards which endpoint.
// Each limiter counts requests per visitor IP address, per endpoint, per minute.
// The Stripe webhook is not limited; its signature check protects it.
const RATE_LIMITERS = {
  'GET /stats': 'RL_READ',
  'GET /recent': 'RL_READ',
  'GET /session': 'RL_WRITE',
  'POST /checkout': 'RL_WRITE',
  'POST /portal': 'RL_WRITE',
  'POST /contact': 'RL_CONTACT',
};
const MAX_BODY_CHARS = 10000;
const EMAIL_TRIES = 2;

// Exchange rates for the counter: the European Central Bank's daily reference
// rates, fetched at most twice a day. FX_TO_EUR is only the fallback.
const ECB_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const FX_KEY = 'fx-v1';
const FX_FRESH_SECONDS = 12 * 3600;
// A pop-up for a gift this large (in EUR) never names the country, so the
// donor cannot be picked out.
const HIDE_COUNTRY_FROM_EUR = 250;
// Monthly gifts that count: paid up, or Stripe is still retrying the card.
const PLEDGED_STATUSES = ['active', 'past_due'];

const PURGE_EVENTS = new Set([
  'checkout.session.completed',
  'invoice.paid',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
]);

// Sent on every response. This API only ever returns data, never a page,
// so it forbids being framed, sniffed or loading anything.
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

export default {
  async fetch(request, env, ctx) {
    const response = await handleRequest(request, env, ctx);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    return response;
  },
};

async function handleRequest(request, env, ctx) {
  {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

    // Stripe calls this server-to-server: no CORS, signature check instead.
    if (route === 'POST /stripe-webhook') return handleWebhook(request, env, ctx);

    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (await rateLimited(request, env, route)) {
        return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '60' });
      }
      switch (route) {
        case 'POST /checkout':
          return await handleCheckout(request, env, cors);
        case 'GET /stats':
          return json((await getSummary(env, ctx)).stats, 200, cors, 60);
        case 'GET /recent':
          return json({ items: withMinutesAgo((await getSummary(env, ctx)).recent) }, 200, cors, 60);
        case 'GET /session':
          return await handleSession(url, env, cors, ctx);
        case 'POST /portal':
          return await handlePortal(request, env, cors);
        case 'POST /contact':
          return await handleContact(request, env, cors);
        default:
          return json({ error: 'not_found' }, 404, cors);
      }
    } catch (err) {
      if (err instanceof TooLargeError) return json({ error: 'too_large' }, 413, cors);
      // Message only: never log request bodies or Stripe objects (personal data).
      console.error(`${route} failed: ${err?.message}`);
      return json({ error: 'server_error' }, 503, cors);
    }
  }
}

// ---------------------------------------------------------------- helpers

function stripeFor(env) {
  const key = env.STRIPE_SECRET_KEY || '';
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  // Safety net: a live key must never run outside production, and vice versa.
  const isLiveKey = key.includes('_live_');
  if (isLiveKey !== (env.ENVIRONMENT === 'production')) {
    throw new Error('Stripe key mode does not match ENVIRONMENT');
  }
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: STRIPE_TIMEOUT_MS,
    // Retries are safe: the library sends the same idempotency key each time,
    // so a retried request can never create a second payment page.
    maxNetworkRetries: STRIPE_RETRIES,
  });
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = { Vary: 'Origin' };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

// Write endpoints only accept calls from our own pages.
function originAllowed(request, env) {
  return allowedOrigins(env).includes(request.headers.get('Origin'));
}

function json(body, status = 200, extraHeaders = {}, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      ...extraHeaders,
    },
  });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function rateLimited(request, env, route) {
  const limiter = env[RATE_LIMITERS[route]];
  if (!limiter) return false;
  const { success } = await limiter.limit({ key: `${route}:${clientIp(request)}` });
  return !success;
}

// Cloudflare Turnstile: the page shows the widget and sends its token here.
// Returns true when the visitor passed the check.
async function passesSpamCheck(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) {
    // Never run live without it; the sandbox may skip it until the page has the widget.
    if (env.ENVIRONMENT === 'production') throw new Error('TURNSTILE_SECRET_KEY is not set');
    return true;
  }
  if (typeof token !== 'string' || !token || token.length > 2048) return false;

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  form.append('remoteip', clientIp(request));
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Turnstile returned ${res.status}`);
  return (await res.json()).success === true;
}

class TooLargeError extends Error {}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new TooLargeError('Request body too large');
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

function countryName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || null;
  } catch {
    return null;
  }
}

// The page's spelling for a single gift is "one-time". Gifts made before that
// was settled are stored as "once".
function frequencyLabel(value) {
  return value === 'monthly' ? 'monthly' : 'one-time';
}

// "minutesAgo" is worked out when the feed is served, not when it is cached.
function withMinutesAgo(recent) {
  const nowSec = Math.floor(Date.now() / 1000);
  // The exact time is kept on our side only; the page gets "minutes ago".
  return recent.map(({ createdAt, ...item }) => ({
    ...item,
    minutesAgo: Math.max(1, Math.round((nowSec - createdAt) / 60)),
  }));
}

// ---------------------------------------------------------------- checkout

async function handleCheckout(request, env, cors) {
  if (!originAllowed(request, env)) return json({ error: 'forbidden' }, 403, cors);

  const body = await readJson(request);
  const currency = String(body.currency || '').toLowerCase();
  const limits = CURRENCIES[currency];
  if (!limits) return json({ error: 'invalid_currency' }, 400, cors);

  // The gift itself, before any card fee. The page sends it as `giftAmount`
  // (its `amount` is the total it displayed, which is ignored here). Cents are
  // allowed; anything finer is refused.
  const giftUnits = Number(body.giftAmount ?? body.amount);
  const gift = Math.round(giftUnits * 100); // minor units (cents)
  const validGift = Number.isFinite(giftUnits) && Math.abs(giftUnits * 100 - gift) < 1e-6;
  if (!validGift || gift < limits.min * 100 || gift > limits.max * 100) {
    return json({ error: 'invalid_amount', min: limits.min, max: limits.max }, 400, cors);
  }

  if (!['monthly', 'one-time', 'once'].includes(body.frequency)) {
    return json({ error: 'invalid_frequency' }, 400, cors);
  }
  const monthly = body.frequency === 'monthly';
  const lang = body.lang === 'fi' ? 'fi' : 'en';

  // The fee is always recomputed here; whatever the browser calculated is ignored.
  const fee = body.coverFees ? feeCents(gift, env.FEE_PERCENT) : 0;

  const metadata = {
    source: SOURCE,
    frequency: frequencyLabel(monthly ? 'monthly' : 'one-time'),
    gift_amount: String(gift),
    fee_amount: String(fee),
    // Showing the country is the donor's own choice: only an explicit yes counts.
    show_country: body.showCountry === true ? 'true' : 'false',
    lang,
  };
  // The country shown is the one the donor picked on the page, not the card's.
  const chosenCountry = String(body.donorCountry || '').toUpperCase();
  if (metadata.show_country === 'true' && /^[A-Z]{2}$/.test(chosenCountry)) metadata.donor_country = chosenCountry;
  // Campaign tags from the link the donor followed (?utm_source=... on the page),
  // so each gift in Stripe shows which email or ad brought it. Not personal data.
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  for (const key of ['source', 'medium', 'campaign', 'content']) {
    const value = String(utm[`utm_${key}`] ?? utm[key] ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
    if (value) metadata[`utm_${key}`] = value;
  }

  const params = {
    mode: monthly ? 'subscription' : 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: gift + fee,
          product_data: {
            name: monthly ? 'Monthly gift to the Koivikko Foundation' : 'Gift to the Koivikko Foundation',
          },
          ...(monthly ? { recurring: { interval: 'month' } } : {}),
        },
      },
    ],
    billing_address_collection: 'required', // gives us the country for the feed
    locale: lang,
    success_url: `${env.SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: env.CANCEL_URL,
    metadata,
  };
  if (monthly) {
    params.subscription_data = { metadata };
  } else {
    params.submit_type = 'donate';
    params.payment_intent_data = { metadata };
  }

  // Optional: also require the spam check before a donation can start.
  if (env.TURNSTILE_ON_CHECKOUT === 'true' && !(await passesSpamCheck(request, env, body.turnstileToken))) {
    return json({ error: 'spam_check_failed' }, 403, cors);
  }

  // The page sends one id per gift attempt and repeats it if the donor has to
  // press the button again after a failed call. Stripe then hands back the same
  // payment page instead of making a second one.
  const attempt = ATTEMPT_ID_RE.test(String(body.attemptId || '')) ? body.attemptId : null;
  const stripe = stripeFor(env);
  let session;
  try {
    session = await stripe.checkout.sessions.create(
      params,
      attempt ? { idempotencyKey: `koivikko-checkout-${attempt}` } : undefined,
    );
  } catch (err) {
    // Same id but different details (should not happen): start a fresh one.
    if (!attempt || err?.type !== 'StripeIdempotencyError') throw err;
    session = await stripe.checkout.sessions.create(params);
  }
  return json({ url: session.url }, 200, cors);
}

// ---------------------------------------------------------------- thank-you

async function handleSession(url, env, cors, ctx) {
  const id = url.searchParams.get('session_id') || url.searchParams.get('id') || '';
  if (!SESSION_ID_RE.test(id)) return json({ error: 'invalid_id' }, 400, cors);

  let session;
  try {
    session = await stripeFor(env).checkout.sessions.retrieve(id);
  } catch (err) {
    if (err?.statusCode === 404) return json({ error: 'not_found' }, 404, cors);
    throw err;
  }
  if (session.metadata?.source !== SOURCE) return json({ error: 'not_found' }, 404, cors);
  const gift = Number(session.metadata.gift_amount) || 0;
  const fee = Number(session.metadata.fee_amount) || 0;

  // A donor who has just paid should see their gift in the counter when they go
  // back to the page, even if Stripe's own notice has not arrived yet.
  if (session.payment_status === 'paid' && session.created > nowSeconds() - 3600) {
    ctx.waitUntil(recountIfMissing(env, session.created).catch(logFailure('Refreshing after a gift')));
  }

  return json(
    {
      paid: session.payment_status === 'paid',
      amount: (gift + fee) / 100, // what the donor was charged
      giftAmount: gift / 100,
      feeAmount: fee / 100,
      currency: String(session.currency).toUpperCase(),
      frequency: frequencyLabel(session.metadata.frequency),
    },
    200,
    cors,
  );
}

// ---------------------------------------------------------------- customer portal

// Lets a monthly donor cancel or change their card on Stripe's own portal page.
//  - Straight after donating, the thank-you page sends its session id and gets
//    a one-off portal link for that donor (direct: true).
//  - Otherwise (no id, old id, one-time gift) it gets Stripe's portal login
//    page, where the donor types their email and Stripe emails them a link
//    (direct: false). We never look donors up by email ourselves.
async function handlePortal(request, env, cors) {
  if (!originAllowed(request, env)) return json({ error: 'forbidden' }, 403, cors);

  const loginPage = () =>
    env.PORTAL_LOGIN_URL
      ? json({ url: env.PORTAL_LOGIN_URL, direct: false }, 200, cors)
      : json({ error: 'not_available' }, 404, cors);

  const body = await readJson(request);
  const id = String(body.sessionId || '');
  if (!SESSION_ID_RE.test(id)) return loginPage();

  const stripe = stripeFor(env);
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(id);
  } catch (err) {
    if (err?.statusCode === 404) return loginPage();
    throw err;
  }

  const fresh = session.created >= Math.floor(Date.now() / 1000) - PORTAL_DIRECT_SECONDS;
  const ours = session.metadata?.source === SOURCE;
  if (!ours || !fresh || session.mode !== 'subscription' || !session.customer) return loginPage();

  const portal = await stripe.billingPortal.sessions.create({
    customer: session.customer,
    return_url: new URL(env.SUCCESS_URL).origin + '/',
    ...(env.PORTAL_CONFIGURATION_ID ? { configuration: env.PORTAL_CONFIGURATION_ID } : {}),
  });
  return json({ url: portal.url, direct: true }, 200, cors);
}

// ---------------------------------------------------------------- counter + feed

// Kept in memory by each running copy of this Worker. Only plain data and
// timestamps: never a promise, which must not be shared between requests.
let memo = null; // { record, at }
let rebuildStartedAt = 0;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logFailure = (what) => (err) => console.error(`${what} failed: ${err?.message}`);

// The saved copy: { summary, builtAt }. `fresh` skips the short in-memory copy.
async function readRecord(env, fresh = false) {
  if (!fresh && memo && Date.now() - memo.at < MEMO_SECONDS * 1000) return memo.record;
  let record = await env.CACHE.get(CACHE_KEY, 'json');
  // The store can lag behind a save made a moment ago; never go backwards.
  if (memo?.record && (!record || memo.record.builtAt > record.builtAt)) record = memo.record;
  memo = { record, at: Date.now() };
  return record;
}

async function rebuild(env) {
  rebuildStartedAt = Date.now();
  const record = { summary: await buildSummary(env), builtAt: nowSeconds() };
  memo = { record, at: Date.now() };
  try {
    await env.CACHE.put(CACHE_KEY, JSON.stringify(record), { expirationTtl: KEEP_SECONDS });
  } catch (err) {
    // The store refused the save (for example a daily limit). The numbers are still served from memory.
    logFailure('Saving the summary')(err);
  }
  return record;
}

async function getSummary(env, ctx) {
  const record = await readRecord(env);
  // First run ever (or nothing saved for a day): build it now.
  if (!record) return (await rebuild(env)).summary;

  // Otherwise answer straight away with what we have. If it is getting old,
  // refresh it after the response has gone, and not more than one at a time.
  const old = nowSeconds() - record.builtAt > FRESH_SECONDS;
  const alreadyRefreshing = Date.now() - rebuildStartedAt < 20000;
  if (old && !alreadyRefreshing) ctx.waitUntil(rebuild(env).catch(logFailure('Refreshing the summary')));
  return record.summary;
}

// After a Stripe event: refresh the saved copy, but when many events arrive
// together (one gift sends several) only one of them does the work.
async function refreshAfterEvent(env) {
  const eventAt = nowSeconds();
  const record = await readRecord(env, true);
  const wait = record ? Math.max(0, record.builtAt + REBUILD_GAP_SECONDS - eventAt) : 0;
  await sleep((wait + Math.random() * 2) * 1000);
  const latest = await readRecord(env, true);
  if (latest && latest.builtAt >= eventAt) return; // another event already refreshed it
  await rebuild(env);
}

// Dispute states where the money has left, or may leave, the account.
const DISPUTE_OPEN_OR_LOST = new Set(['needs_response', 'under_review', 'lost']);

// What a monthly donor gives per month, in minor units, without the card fee.
// The page stores the gift and fee on the subscription when it is created. If the
// price in Stripe still equals gift + fee, that stored gift is right. If someone
// has since changed the amount in the Stripe dashboard, the price is the truth.
function monthlyGift(sub) {
  let perMonth = 0;
  for (const item of sub.items?.data || []) {
    const price = item.price || {};
    const every = price.recurring?.interval_count || 1;
    const months = price.recurring?.interval === 'year' ? 12 * every : every;
    perMonth += ((price.unit_amount || 0) * (item.quantity ?? 1)) / months;
  }
  const gift = Number(sub.metadata?.gift_amount) || 0;
  const fee = Number(sub.metadata?.fee_amount) || 0;
  if (!perMonth) return gift; // no usable price: fall back to what the page stored
  if (gift && perMonth === gift + fee) return gift; // unchanged since the donor gave
  return perMonth;
}

// Recount now if the saved copy does not yet show the gift made at this time.
async function recountIfMissing(env, createdAt) {
  const record = await readRecord(env);
  if (record?.summary.recent.some((item) => item.createdAt === createdAt)) return;
  await refreshAfterEvent(env);
}

// What one unit of each currency is worth in euros. Uses the saved ECB rates
// while they are fresh, fetches new ones when they are not, and falls back to
// the last saved rates, then to FX_TO_EUR, if the ECB cannot be reached.
async function ratesToEur(env) {
  const fallback = JSON.parse(env.FX_TO_EUR);
  let saved = null;
  try {
    saved = await env.CACHE.get(FX_KEY, 'json');
  } catch (err) {
    logFailure('Reading saved exchange rates')(err);
  }
  if (saved && nowSeconds() - saved.fetchedAt < FX_FRESH_SECONDS) return { ...fallback, ...saved.rates };
  try {
    const res = await fetch(ECB_RATES_URL, { signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ECB returned ${res.status}`);
    const rates = parseEcbRates(await res.text());
    await env.CACHE.put(FX_KEY, JSON.stringify({ rates, fetchedAt: nowSeconds() })).catch(logFailure('Saving exchange rates'));
    return { ...fallback, ...rates };
  } catch (err) {
    logFailure('Fetching exchange rates')(err);
    return { ...fallback, ...(saved?.rates || {}) };
  }
}

async function buildSummary(env) {
  const stripe = stripeFor(env);
  const fx = await ratesToEur(env);
  // A gift in a currency with no rate is left out of the totals (and logged once),
  // so one missing rate cannot stop the whole counter from refreshing.
  const noRate = new Set();
  const toEur = (minor, currency) => {
    const rate = fx[currency];
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      if (!noRate.has(currency)) console.error(`No EUR rate for ${currency}: those gifts are left out of the totals`);
      noRate.add(currency);
      return 0;
    }
    return (minor / 100) * rate;
  };

  // 1) Regular donors: monthly gifts created by this page. A gift whose card
  //    failed stays in while Stripe is still retrying it; Stripe cancels it if
  //    the retries run out, and then it drops out here.
  const donors = new Set(); // people, not gifts: one person with two gifts counts once
  let monthlyPledged = 0;
  const activeSubscriptionIds = new Set();
  for (const status of PLEDGED_STATUSES) {
    for await (const sub of stripe.subscriptions.list({ status, limit: 100, expand: ['data.customer'] })) {
      if (sub.metadata?.source !== SOURCE) continue;
      // A paused gift still reads "active" in Stripe, but nothing is being collected.
      if (sub.pause_collection) continue;
      activeSubscriptionIds.add(sub.id);
      // Told apart by email, used only for this count and never kept or logged.
      const who = sub.customer;
      donors.add(String((typeof who === 'object' ? who?.email || who?.id : who) || sub.id).toLowerCase());
      monthlyPledged += toEur(monthlyGift(sub), sub.currency);
    }
  }
  const activeMonthlyDonors = donors.size;

  // Money that went back to the donor since the window began, by payment.
  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const monthStart = monthStartSeconds(now); // Finnish time
  const since = Math.min(monthStart, nowSec - RECENT_DAYS * 86400);

  const refunded = new Map(); // payment id -> minor units refunded
  for await (const r of stripe.refunds.list({ created: { gte: since }, limit: 100 })) {
    if (!r.payment_intent || r.status === 'failed' || r.status === 'canceled') continue;
    refunded.set(r.payment_intent, (refunded.get(r.payment_intent) || 0) + r.amount);
  }
  const disputed = new Set(); // payment ids the donor's bank is taking back, or has
  for await (const d of stripe.disputes.list({ created: { gte: since }, limit: 100 })) {
    if (d.payment_intent && DISPUTE_OPEN_OR_LOST.has(d.status)) disputed.add(d.payment_intent);
  }

  // 2) Completed checkouts: one-time gifts this calendar month (Finnish time) + the feed.
  let oneTimeThisMonth = 0;
  const recent = [];
  const sessions = stripe.checkout.sessions.list({ created: { gte: since }, status: 'complete', limit: 100 });
  for await (const s of sessions) {
    if (s.metadata?.source !== SOURCE || s.payment_status !== 'paid') continue;
    const gift = Number(s.metadata.gift_amount) || 0;
    const monthly = s.mode === 'subscription';

    // A one-time gift that was fully refunded or disputed is dropped everywhere.
    // A part refund keeps the gift in the feed and counts the part that was kept.
    let kept = 1;
    if (!monthly && s.payment_intent) {
      const back = refunded.get(s.payment_intent) || 0;
      if (disputed.has(s.payment_intent) || (s.amount_total > 0 && back >= s.amount_total)) continue;
      if (s.amount_total > 0) kept = 1 - back / s.amount_total;
    }

    if (!monthly && s.created >= monthStart) oneTimeThisMonth += toEur(gift * kept, s.currency);

    // A monthly pledge that has since been cancelled or paused is dropped from the feed.
    const stillPledged = !monthly || activeSubscriptionIds.has(s.subscription);

    if (stillPledged && recent.length < RECENT_LIMIT && s.created >= nowSec - RECENT_DAYS * 86400) {
      // The country the donor chose to show (the card's country for gifts made
      // before that was stored). Never shown for a large gift.
      const large = toEur(gift, s.currency) >= HIDE_COUNTRY_FROM_EUR;
      const code = s.metadata.show_country === 'false' || large
        ? null
        : s.metadata.donor_country || s.customer_details?.address?.country || null;
      recent.push({
        country: code, // ISO code, or null when hidden
        countryName: code ? countryName(code) : null,
        amount: gift / 100, // in the currency the donor gave in
        currency: String(s.currency).toUpperCase(),
        frequency: frequencyLabel(monthly ? 'monthly' : 'one-time'),
        createdAt: s.created,
      });
    }
  }

  // The totals are added up in euros, then shown in COUNTER_CURRENCY (e.g. AUD)
  // at the same ECB rate. Without a usable rate for it, the counter stays in EUR.
  const wanted = String(env.COUNTER_CURRENCY || 'EUR').toLowerCase();
  const perUnit = fx[wanted];
  const shown = wanted !== 'eur' && typeof perUnit === 'number' && Number.isFinite(perUnit) && perUnit > 0 ? wanted : 'eur';
  const inShown = (eur) => Math.round(shown === 'eur' ? eur : eur / perUnit);
  if (shown !== wanted) console.error(`No EUR rate for ${wanted}: the counter is shown in EUR`);

  return {
    stats: {
      activeMonthlyDonors,
      monthlyPledgedTotal: inShown(monthlyPledged),
      oneTimeThisMonth: inShown(oneTimeThisMonth),
      combinedThisMonth: inShown(monthlyPledged + oneTimeThisMonth),
      currency: shown.toUpperCase(),
      supporterGoal: Number(env.SUPPORTER_GOAL) || null,
      updatedAt: nowSec,
    },
    recent,
  };
}

// ---------------------------------------------------------------- webhook

async function handleWebhook(request, env, ctx) {
  const signature = request.headers.get('stripe-signature');
  const payload = await request.text();
  let event;
  try {
    event = await stripeFor(env).webhooks.constructEventAsync(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response('invalid signature', { status: 400 });
  }

  // Answer Stripe at once and do the work afterwards, so Stripe never times out
  // and re-sends. The work is a full recount from Stripe, so a repeated, late or
  // out-of-order event cannot double-count.
  if (PURGE_EVENTS.has(event.type)) {
    ctx.waitUntil(refreshAfterEvent(env).catch(logFailure('Refreshing after a Stripe event')));
  }
  return new Response('ok');
}

// ---------------------------------------------------------------- AU family-trust enquiry

async function handleContact(request, env, cors) {
  if (!originAllowed(request, env)) return json({ error: 'forbidden' }, 403, cors);

  const body = await readJson(request);
  // Honeypot: real visitors never fill the hidden "leaveBlank" field. Pretend success.
  // (It is not called "company" or "website": browsers autofill fields with those names.)
  if (body.leaveBlank) return json({ ok: true }, 200, cors);
  if (!(await passesSpamCheck(request, env, body.turnstileToken))) {
    return json({ error: 'spam_check_failed' }, 403, cors);
  }

  const clean = (v, max) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  const message = String(body.message ?? '').trim().slice(0, 3000);

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'invalid_input' }, 400, cors);
  }
  if (!env.RESEND_API_KEY || !env.CONTACT_TO_EMAIL) {
    throw new Error('Contact email is not configured');
  }

  const mail = JSON.stringify({
    from: env.CONTACT_FROM_EMAIL,
    to: [env.CONTACT_TO_EMAIL],
    reply_to: email,
    subject: 'Koivikko: Australian family trust donation enquiry',
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || '-'}\n\n${message || '(no message)'}`,
  });
  // Nothing is stored here, so an enquiry that cannot be emailed would be gone.
  // Try twice (the same key both times, so it can never arrive twice), and if it
  // still fails say so plainly: the page keeps what the visitor typed.
  const sendKey = crypto.randomUUID();
  let problem = '';
  for (let tries = 1; tries <= EMAIL_TRIES; tries++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': sendKey,
        },
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
        body: mail,
      });
      if (res.ok) return json({ ok: true }, 200, cors);
      problem = `Email provider returned ${res.status}`;
      if (res.status < 500 && res.status !== 429) break; // our mistake: trying again will not help
    } catch (err) {
      problem = `Email provider could not be reached (${err?.name})`;
    }
  }
  console.error(`POST /contact failed: ${problem}`);
  return json({ error: 'email_failed' }, 502, cors);
}
