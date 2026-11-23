/* Koivikko donation landing — front-end logic (no dependencies) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CFG = window.KOIVIKKO_CONFIG;
  const API = window.KoivikkoApi;
  // A key file failed to load: stop here. safe-mode.js then pauses giving with a clear message.
  if (!CFG || !API || !window.KoivikkoCountry) return;
  // Translations (i18n.js): tr() for plain text, trHtml() for our own markup with escaped values
  const I18N = window.KoivikkoI18n || { lang: 'en', locale: 'en', t: (k) => k, tHtml: (k) => k };
  const tr = I18N.t; const trHtml = I18N.tHtml;

  // ---------------------------------------------------------------- analytics (PRD 7.5)
  // Events go to window.dataLayer (analytics.js forwards them to Google after consent).
  // They are also printed to the console, but only on this computer (localhost), never live.
  const DEBUG = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  window.dataLayer = window.dataLayer || [];
  function track(event, props = {}) {
    const payload = { event, ...props, ...utm };
    window.dataLayer.push(payload);
    if (DEBUG) console.info('[track]', payload);
  }

  // UTM capture so Kevin can see which email/ad brought each donor.
  // Anyone can edit a link, so tags are cleaned: only the 4 known tags, no control characters
  // or < > " ' ` \, at most 100 characters each. (A huge tag would otherwise make the checkout
  // request too large for the backend and the gift would fail.) The backend cleans them again.
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  const cleanTag = (v) => (typeof v === 'string' ? v : '')
    .replace(/[\p{Cc}<>"'`\\]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const cleanUtm = (src) => {
    const out = {};
    UTM_KEYS.forEach((k) => { const v = cleanTag(src && src[k]); if (v) out[k] = v; });
    return out;
  };
  const utm = {};
  try {
    const qs = new URLSearchParams(location.search);
    const fromLink = cleanUtm(Object.fromEntries(UTM_KEYS.map((k) => [k, qs.get(k)])));
    if (Object.keys(fromLink).length) { Object.assign(utm, fromLink); sessionStorage.setItem('k_utm', JSON.stringify(utm)); }
    else Object.assign(utm, cleanUtm(JSON.parse(sessionStorage.getItem('k_utm') || '{}')));
  } catch { /* storage blocked or unreadable: no tags */ }

  $$('[data-track]').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.track === 'donate_click') {
      track('donate_click', { location: el.dataset.loc });
      focusForm();
    } else track(el.dataset.track);
  }));

  function focusForm() {
    setTimeout(() => $('#give').focus({ preventScroll: true }), 400);
  }

  // Mockup helper: highlight placeholder copy
  $('#showPh')?.addEventListener('change', (e) => document.body.classList.toggle('show-ph', e.target.checked));

  // Language: the flag dropdown is built by i18n.js

  // ---------------------------------------------------------------- money formatting
  const SYM = { EUR: '€', AUD: 'A$', USD: '$' };
  const fmt = (n, cur, dp = 0) => new Intl.NumberFormat(I18N.locale, {
    style: 'currency', currency: cur, minimumFractionDigits: dp, maximumFractionDigits: dp,
  }).format(n);
  // Security: anything that came from the API or the URL is escaped before it touches innerHTML
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CURRENCIES = new Set(CFG.currencies.concat('EUR'));
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

  // ---------------------------------------------------------------- donation form (PRD 6.5)
  // Presets, limits and impact copy live in config.js (placeholders: Q3, Q4, Q5)
  const PRESETS = CFG.presets;
  const DEFAULT_IDX = CFG.defaultPresetIndex;
  const IMPACT = CFG.impact;
  const MIN = Object.fromEntries(Object.entries(CFG.limits).map(([c, l]) => [c, l[0]]));
  const MAX = Object.fromEntries(Object.entries(CFG.limits).map(([c, l]) => [c, l[1]]));
  // fee-rule:start  The same rule as feeCents in backend/src/rules.js; a backend test compares the two.
  // Whole numbers only (cents, and the rate in hundredths of a percent), so a gift
  // that lands exactly between two 0.05 steps rounds the same way on the server.
  const feeFor = (a) => {
    const n = Math.round(a * 100) * Math.round(CFG.coverFeesRate * 10000);
    return Math.max(30, Math.round(n / 50000) * 5) / 100;
  };
  // fee-rule:end

  const form = $('#donateForm');
  const amountsEl = $('#amounts');
  const otherWrap = $('#otherWrap');
  const otherInput = $('#otherAmount');
  const currencyEl = $('#currency');
  const s = { frequency: 'monthly', currency: 'EUR', idx: DEFAULT_IDX, other: false };
  // Fix 4: has the donor picked or typed an amount yet? (then a currency switch gets a notice)
  let amountTouched = false;
  const touchAmount = () => { amountTouched = true; const n = $('#curChangeNote'); if (n) n.hidden = true; };

  // ---------------------------------------------------------------- donor country → currency
  // Australia → AUD, Europe → EUR, everywhere else → USD (rules live in country.js)
  const C = window.KoivikkoCountry;
  const cDlg = $('#countryDialog');
  const cSel = $('#countrySelect');
  let country = null;

  function applyCountry(code, { save = false, source = 'guess' } = {}) {
    if (!C.isValid(code)) return;
    code = code.toUpperCase();
    country = code;
    const cur = C.currencyFor(code);
    // Fix 4: the donor already chose an amount and the currency changes: say so, never change it silently
    const note = $('#curChangeNote');
    if (note) {
      const changed = cur !== s.currency && amountTouched && source !== 'guess';
      note.hidden = !changed;
      note.textContent = changed ? tr('cur.changed', { currency: tr('cur.' + cur) }) : '';
    }
    if (cur !== s.currency || !s.other) s.idx = DEFAULT_IDX;
    s.currency = cur; currencyEl.value = cur;
    $('#countryName').textContent = C.nameOf(code);
    $('#givingFrom').hidden = false;
    // Point tax-receipt donors at the pathway made for them
    $$('[data-open-au]').forEach((el) => (el.closest('.way') || el).classList.toggle('is-suggested', code === 'AU'));
    $$('[data-oci]').forEach((el) => (el.closest('.way') || el).classList.toggle('is-suggested', code === 'US'));
    if (save) { C.save(code); track('country_select', { country: code, currency: cur, source }); }
    update();
  }

  const curLabel = (code) => {
    const cur = C.currencyFor(code);
    return tr('country.give', { currency: tr('cur.' + cur) });
  };
  function openCountryDialog() {
    if (!cSel.options.length) {
      const frag = document.createDocumentFragment();
      C.list().forEach(({ code, name }) => { const o = document.createElement('option'); o.value = code; o.textContent = name; frag.append(o); });
      cSel.append(frag);
    }
    // Pre-select the current or guessed country: most donors only need to press Continue
    cSel.value = country || C.guess() || 'US';
    $('#countryCur').textContent = curLabel(cSel.value);
    cDlg.showModal();
    cSel.focus();
    renderCountryCheck();
  }

  // ---------------------------------------------------------------- spam check in the country popup
  // Cloudflare's official always-pass test key, used only in demo mode so reviewers can see the widget.
  const TURNSTILE_TEST_KEY = '1x00000000000000000000AA';
  const TOKEN_LIFE_MS = 280000; // Turnstile tokens expire after 300 s; keep a safety margin
  let countryWidget = null; let countryToken = null; let countryTokenAt = 0;
  const countryTokenFresh = () => !!countryToken && Date.now() - countryTokenAt < TOKEN_LIFE_MS;
  function renderCountryCheck() {
    const key = API.isMock ? TURNSTILE_TEST_KEY : CFG.turnstileSiteKey;
    const box = $('#countrySpamCheck'); const hint = $('#countrySpamHint'); const cont = $('#countryContinue');
    const unlock = () => { cont.disabled = false; hint.hidden = true; };
    if (!CFG.spamCheckOnCountry || !key || countryTokenFresh()) { unlock(); return; } // off, or already passed
    box.hidden = false; hint.hidden = false; cont.disabled = true;
    loadTurnstile().then((ts) => {
      if (countryWidget !== null) { ts.reset(countryWidget); return; }
      countryWidget = ts.render(box, {
        sitekey: key, language: I18N.lang,
        size: box.clientWidth < 300 ? 'compact' : 'flexible', // fits small phones
        callback: (token) => { countryToken = token; countryTokenAt = Date.now(); unlock(); track('spam_check_passed', { where: 'country' }); },
        'expired-callback': () => { countryToken = null; cont.disabled = true; hint.hidden = false; },
        'error-callback': () => { unlock(); }, // never trap a donor: the server is the real gate
      });
    }).catch(unlock); // blocked by an ad blocker or offline: let them continue
  }
  cSel.addEventListener('change', () => { $('#countryCur').textContent = curLabel(cSel.value); });
  $('#countryForm').addEventListener('submit', (e) => {
    e.preventDefault(); cDlg.close(); applyCountry(cSel.value, { save: true, source: 'list' });
  });
  // Closing with × or Esc keeps the current (guessed) country, so the form is never left without a currency
  $('#changeCountry').addEventListener('click', openCountryDialog);

  // Start-up: ?country=AU in an ad link → use it and skip the question; saved answer → reuse; else guess + ask
  const fromUrl = (new URLSearchParams(location.search).get('country') || '').toUpperCase();
  if (C.isValid(fromUrl)) applyCountry(fromUrl, { save: true, source: 'url' });
  else if (C.saved()) applyCountry(C.saved());
  else {
    applyCountry(C.guess() || 'US');
    // A1: someone arriving from a Google Ads click is not stopped by a question. The guess is used
    // and "Change" is right there. (gclid/gbraid/wbraid are the click ids Google Ads adds to links.)
    const qs = new URLSearchParams(location.search);
    const fromAd = CFG.skipCountryPopupForAds !== false && ['gclid', 'gbraid', 'wbraid'].some((k) => qs.has(k));
    // A4: if the visitor already started choosing a gift, do not interrupt them with the popup
    let started = false;
    const markStarted = () => { started = true; };
    ['pointerdown', 'keydown', 'input'].forEach((ev) => $('#give').addEventListener(ev, markStarted, { once: true }));
    if (fromAd) track('country_popup_skipped', { reason: 'ad' });
    else setTimeout(() => {
      if (started) { track('country_popup_skipped', { reason: 'busy' }); return; }
      if (!document.querySelector('dialog[open]')) openCountryDialog();
    }, 900);
  }

  function amount() {
    // Other amount: rounded to cents so the label, the fee and checkout all agree
    if (s.other) { const v = parseAmount(otherInput.value); return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0; }
    return PRESETS[s.frequency][s.currency][s.idx];
  }
  // A5: accepts "25", "12.50", "12,50", "1,000", "1 000", "€50", "A$40", "50 AUD".
  // Returns NaN for anything else ("-5", "1e3", "abc"), so the button says "Choose an amount".
  function parseAmount(raw) {
    let v = String(raw || '').replace(/US\$|A\$|AUD|EUR|USD|[€$\s\u00a0\u202f]/gi, '');
    if (!v) return 0;
    if (/[^\d.,]/.test(v)) return NaN;
    const last = Math.max(v.lastIndexOf('.'), v.lastIndexOf(','));
    if (last === -1) return Number(v);
    const tail = v.slice(last + 1); const head = v.slice(0, last).replace(/[.,]/g, '');
    if (tail.length === 3) return Number(head + tail);  // "1,000" or "1.000" = one thousand
    if (tail.length > 3) return NaN;
    return Number(head + '.' + tail);                    // "12,50" or "12.50" = twelve and a half
  }
  function renderAmounts() {
    const list = PRESETS[s.frequency][s.currency];
    amountsEl.replaceChildren();
    list.forEach((v, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'amt'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(!s.other && s.idx === i));
      b.tabIndex = (!s.other && s.idx === i) || (s.other && i === 0) ? 0 : -1;
      b.innerHTML = fmt(v, s.currency) + (i === DEFAULT_IDX ? `<span class="pop">${esc(tr('amount.popular'))}</span>` : '');
      b.addEventListener('click', () => { s.idx = i; s.other = false; touchAmount(); update(); });
      amountsEl.appendChild(b);
    });
    const o = document.createElement('button');
    o.type = 'button'; o.className = 'amt'; o.setAttribute('role', 'radio');
    o.setAttribute('aria-checked', String(s.other)); o.tabIndex = s.other ? 0 : -1;
    o.textContent = tr('amount.other');
    o.addEventListener('click', () => { s.other = true; touchAmount(); update(); otherInput.focus(); });
    amountsEl.appendChild(o);
  }
  // Arrow-key support for the radiogroup
  amountsEl.addEventListener('keydown', (e) => {
    const btns = $$('.amt', amountsEl); const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = (i + d + btns.length) % btns.length;
    btns[n].click(); $$('.amt', amountsEl)[n].focus();
  });

  function update() {
    renderAmounts();
    otherWrap.hidden = !s.other;
    $('#curSym').textContent = SYM[s.currency];
    const a = amount();
    // A9: say what is wrong right under the field, not only next to the button
    const otherErr = $('#otherError');
    const typed = otherInput.value.trim();
    const badFormat = s.other && typed !== '' && !Number.isFinite(parseAmount(typed));
    const outOfRange = s.other && typed !== '' && !badFormat && (a < MIN[s.currency] || a > MAX[s.currency]);
    otherErr.textContent = badFormat ? tr('err.amountFormat')
      : outOfRange ? tr('err.range', { min: fmt(MIN[s.currency], s.currency), max: fmt(MAX[s.currency], s.currency) }) : '';
    otherErr.hidden = !otherErr.textContent;
    otherInput.setAttribute('aria-invalid', String(badFormat || outOfRange));
    const monthly = s.frequency === 'monthly';
    const fee = feeFor(a);
    $('#feeAmt').textContent = fmt(fee, s.currency, 2);
    $('#feeEvery').textContent = monthly ? ' ' + tr('fee.monthly') : ''; // Fix 3: a monthly fee repeats every month
    const total = Math.round((a + ($('#coverFees').checked ? fee : 0)) * 100) / 100;
    const valid = a >= MIN[s.currency] && a <= MAX[s.currency];
    // Never advertise an amount we will reject ("Give -€5", "Give €999,999,999")
    $('#donateLabel').textContent = valid
      ? tr(monthly ? 'give.monthly' : 'give.once', { amount: fmt(total, s.currency, total % 1 ? 2 : 0) })
      : tr('give.choose');
    const impIdx = s.other ? Math.min(4, Math.floor(a / 60)) : s.idx;
    const impKey = 'impact.' + impIdx; const impT = tr(impKey);
    const imp = impT === impKey ? IMPACT[impIdx] : impT; // English wording comes from config.js
    $('#impact').innerHTML = valid ? trHtml(monthly ? 'impact.monthly' : 'impact.once', { amount: fmt(a, s.currency, a % 1 ? 2 : 0), impact: imp }) : '';

    // Monthly upsell when someone picks "Give once"
    const nudge = $('#nudge');
    nudge.hidden = monthly || !valid;
    if (!monthly && valid) {
      // A7: only suggest a monthly amount that is not more than the one-time gift
      const m = PRESETS.monthly[s.currency].filter((v) => v <= a);
      if (!m.length) nudge.hidden = true;
      else {
        const suggestion = m.reduce((best, v) => (Math.abs(v - a / 2) < Math.abs(best - a / 2) ? v : best), m[0]);
        $('#nudgeBtn').textContent = tr('nudge.button', { amount: fmt(suggestion, s.currency) });
        $('#nudgeBtn').dataset.amount = suggestion;
      }
    }
    $('#formError').hidden = true;
  }

  $$('input[name="frequency"]').forEach((r) => r.addEventListener('change', () => {
    s.frequency = r.value; if (!s.other) s.idx = DEFAULT_IDX; update();
  }));
  currencyEl.addEventListener('change', () => { s.currency = currencyEl.value; update(); });
  otherInput.addEventListener('input', () => { touchAmount(); update(); });
  $('#coverFees').addEventListener('change', update);
  $('#nudgeBtn').addEventListener('click', () => {
    const v = Number($('#nudgeBtn').dataset.amount);
    $('#f-monthly').checked = true; s.frequency = 'monthly';
    s.idx = PRESETS.monthly[s.currency].indexOf(v); s.other = false;
    track('monthly_upsell_accept', { amount: v });
    update();
  });

  // The backend address was never filled in (config.js): say so instead of failing quietly.
  if (API.notConfigured) {
    console.error('Koivikko: apiBase in config.js still holds the placeholder address, so giving cannot work.');
    const note = document.createElement('p');
    note.className = 'form-error'; note.setAttribute('role', 'alert');
    note.textContent = tr('err.notConfigured');
    $('#formError').after(note);
    $('#donateBtn').disabled = true;
  }

  // Fix 1: true from the moment a checkout call starts until it fails (or the donor comes back with Back)
  let giving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (API.notConfigured || giving) return; // already opening checkout: never start a second one
    const a = amount();
    const err = $('#formError');
    if (!a || a < MIN[s.currency] || a > MAX[s.currency]) {
      err.textContent = tr('err.range', { min: fmt(MIN[s.currency], s.currency), max: fmt(MAX[s.currency], s.currency) });
      err.hidden = false;
      if (s.other) otherInput.focus(); // A9: take them to the field that needs fixing
      return;
    }
    // A10: no connection: say so right away instead of waiting for a timeout
    if (navigator.onLine === false) { showGiveError(tr('err.offline'), true); return; }
    const fee = $('#coverFees').checked ? feeFor(a) : 0;
    const body = {
      amount: Math.round((a + fee) * 100) / 100, frequency: s.frequency, currency: s.currency,
      coverFees: !!fee, giftAmount: a, feeAmount: fee, donorCountry: country, showCountry: $('#showCountry').checked, lang: document.documentElement.lang, utm,
    };
    // One id per gift attempt. If the call fails and the donor presses the button again
    // with the same choices, the same id is sent, so only one payment page is ever made.
    const sig = JSON.stringify(body);
    if (!attempt || attempt.sig !== sig) attempt = { sig, id: newAttemptId() };
    body.attemptId = attempt.id;
    // Reuse the country-popup check if it is still fresh (a token works once), else the gift-button widget
    if (CFG.spamCheckOnGift && countryTokenFresh()) { body.turnstileToken = countryToken; countryToken = null; }
    else if (giftWidget && window.turnstile) body.turnstileToken = window.turnstile.getResponse(giftWidget);
    track('checkout_started', { amount: body.amount, frequency: body.frequency, currency: body.currency });
    giving = true;
    const btn = $('#donateBtn'); btn.setAttribute('aria-busy', 'true'); btn.disabled = true; // no double submit
    $('#donateLabel').textContent = tr('give.opening');
    // A10: on a slow connection, tell them it is still working rather than looking stuck
    const slowTimer = setTimeout(() => { $('#donateLabel').textContent = tr('give.slow'); }, 8000);
    try {
      const j = await API.checkout(body);
      // Security: only ever redirect to Stripe Checkout (or the local demo page in mock mode).
      // Blocks javascript: URLs and phishing redirects if the API response is ever tampered with.
      const dest = safeCheckoutUrl(j && j.url);
      if (!dest) throw new Error(tr('err.checkout'));
      attempt = null; // done: a later gift is a new attempt
      clearTimeout(slowTimer);
      location.href = dest;
    } catch (ex) {
      clearTimeout(slowTimer);
      giving = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false; update();
      // A10: when the server could not be reached, offer the bank transfer as a way that always works
      showGiveError(tr('err.nothingCharged', { message: ex.message }), !!ex.noAnswer);
      // Keep the id only when no answer came back (the call may still have arrived).
      // After an answered error, the next press is a fresh attempt.
      if (!ex.noAnswer) attempt = null;
      if (giftWidget && window.turnstile) window.turnstile.reset(giftWidget); // a token works once
    }
  });
  let attempt = null;
  // Error under the gift button, optionally with a link to the bank transfer details (A10)
  function showGiveError(message, offerBank) {
    const err = $('#formError');
    err.textContent = message;
    if (offerBank) {
      const a = document.createElement('a');
      a.href = '#ways'; a.className = 'err-alt'; a.textContent = tr('err.altBank');
      err.append(' ', a);
    }
    err.hidden = false;
  }
  // A10: tell donors straight away when their connection drops, and when it is back
  const netNote = document.createElement('p');
  netNote.className = 'net-note'; netNote.setAttribute('role', 'status'); netNote.hidden = true;
  $('#donateBtn').before(netNote);
  const showNet = () => { netNote.hidden = navigator.onLine !== false; netNote.textContent = tr('net.offline'); };
  addEventListener('offline', showNet); addEventListener('online', showNet); showNet();
  // A random id, 32 letters and digits. Works in older browsers and on plain http,
  // where crypto.randomUUID does not exist.
  function newAttemptId() {
    const c = window.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function safeCheckoutUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      // Exactly Stripe Checkout: https, no port, no user:password@ in front
      if (u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.port && !u.username && !u.password) return u.href;
      if (API.isMock && u.origin === location.origin && /\/checkout-mock\.html$/.test(u.pathname)) return u.href;
    } catch { /* invalid URL */ }
    return null;
  }

  // Keep the form's state in step with what the controls actually show.
  // Browsers can restore a select/radio value after Back or reload without firing
  // "change" — that caused AUD + "Give once" on screen but "$25 monthly" at checkout.
  function syncFromControls(e) {
    // While checkout is opening, leave everything as it is (this used to unlock the button again)
    if (giving && !(e && e.type === 'pageshow')) return;
    if (e && e.type === 'pageshow') giving = false; // back from Stripe with the Back button: ready again
    const freq = ($('input[name="frequency"]:checked') || {}).value || 'monthly';
    const cur = currencyEl.value || s.currency;
    if (freq !== s.frequency || cur !== s.currency) {
      if (!s.other) s.idx = DEFAULT_IDX; // presets differ per currency/frequency
      s.frequency = freq; s.currency = cur;
    }
    const btn = $('#donateBtn'); btn.removeAttribute('aria-busy'); btn.disabled = false; // reset "Opening checkout…" after Back
    update();
  }
  form.addEventListener('submit', syncFromControls, true); // last check before checkout (capture: runs first)
  addEventListener('pageshow', syncFromControls);           // Back/forward cache restore
  addEventListener('load', syncFromControls);               // late form-state restore on reload

  update();

  // ---------------------------------------------------------------- live counter (PRD 6.3)
  function countUp(el, to, money, cur) {
    const render = (v) => { el.textContent = money ? fmt(v, cur) : Math.round(v).toLocaleString(I18N.locale); };
    if (reduceMotion || document.hidden) return render(to);
    const dur = 1600; const t0 = performance.now(); let done = false;
    render(to * 0.6); // never start from "0" (PRD 6.3), even if frames are throttled
    const step = (t) => {
      if (done) return;
      const p = Math.min(1, (t - t0) / dur); const eased = 1 - Math.pow(1 - p, 3);
      render(to * (0.6 + 0.4 * eased)); if (p < 1) requestAnimationFrame(step); else done = true;
    };
    requestAnimationFrame(step);
    setTimeout(() => { done = true; render(to); }, dur + 150); // guaranteed final value
  }

  // A2: below CFG.counterMinDonors the counter invites people to be among the first supporters,
  //     instead of showing small numbers. A3: it refreshes while the page is open.
  const setNum = (el, v, money, cur) => { el.textContent = money ? fmt(v, cur) : Math.round(v).toLocaleString(I18N.locale); };
  let statsShown = false;
  function showStats(d, first) {
    // Validate before showing: must be real positive numbers in a known currency
    const donors = num(d && d.activeMonthlyDonors); const total = num(d && d.monthlyPledgedTotal);
    if (!(donors >= 1) || !(total >= 0) || !CURRENCIES.has(d.currency)) { if (!statsShown) $('#counter').hidden = true; return; } // never show 0 or junk
    d = { ...d, activeMonthlyDonors: Math.floor(donors), monthlyPledgedTotal: total };
    // Show the total in the counter currency (AUD), converting if the backend used another one
    const showCur = CFG.counterCurrency || d.currency;
    let showTotal = d.monthlyPledgedTotal;
    if (showCur !== d.currency) {
      const from = num(CFG.toAUD && CFG.toAUD[d.currency]); const to = num(CFG.toAUD && CFG.toAUD[showCur]);
      if (from > 0 && to > 0) showTotal = Math.round((showTotal * from) / to);
      else { if (!statsShown) $('#counter').hidden = true; return; } // no rate: hide rather than show a wrong number
    }
    const n = d.activeMonthlyDonors;
    const goal = CFG.supporterGoal;
    const early = n < Math.max(1, Number(CFG.counterMinDonors) || 1);
    const counter = $('#counter');
    counter.hidden = false; counter.classList.remove('is-loading'); counter.classList.toggle('is-early', early);
    $('.counter-line').hidden = early;
    const earlyLine = $('#counterEarly');
    earlyLine.hidden = !early;
    earlyLine.textContent = early ? tr(goal ? 'counter.early' : 'counter.earlyNoGoal', { goal }) : '';
    if (!early) {
      $('#peopleWord').textContent = tr(n === 1 ? 'counter.person' : 'counter.people');
      if (first || !statsShown) { countUp($('[data-count="donors"]'), n); countUp($('[data-count="total"]'), showTotal, true, showCur); }
      else { setNum($('[data-count="donors"]'), n); setNum($('[data-count="total"]'), showTotal, true, showCur); }
    }
    if (goal && !early) {
      $('#progressWrap').hidden = false;
      const pct = Math.min(100, (n / goal) * 100);
      const bar = $('#progressbar');
      bar.setAttribute('aria-valuemax', goal); bar.setAttribute('aria-valuenow', n);
      // Past the goal: say so, instead of "120 of 100"
      const reached = n >= goal;
      $('#progressText').textContent = reached
        ? tr(n === 1 ? 'progress.reached1' : 'progress.reached', { n, goal })
        : tr('progress.of', { n, goal });
      const goalWords = $('#progressText').nextElementSibling;
      if (goalWords) goalWords.hidden = reached;
      const fill = $('#progressFill');
      void fill.offsetWidth; // force layout so the width transition runs
      setTimeout(() => { fill.style.width = pct + '%'; }, 120);
    } else $('#progressWrap').hidden = true;
    // Early on, do not advertise small numbers anywhere else either
    $('#nextNum').hidden = early;
    $('#nextNum').textContent = '#' + (n + 1);
    $('#stickyCount').innerHTML = early ? trHtml('sticky.early') : trHtml('sticky', { n });
    statsShown = true;
  }
  function loadStats(first) {
    return API.stats().then((d) => showStats(d, first))
      .catch(() => { if (!statsShown) $('#counter').hidden = true; }); // hide quietly (PRD 6.3); keep last numbers on a failed refresh
  }
  loadStats(true);
  const refreshEvery = Number(CFG.counterRefreshSeconds) || 0;
  if (refreshEvery >= 15) setInterval(() => { if (!document.hidden) loadStats(false); }, refreshEvery * 1000);

  // ---------------------------------------------------------------- sticky mobile CTA
  // Shown only when neither the gift form nor the footer is on screen (one source of truth,
  // so scrolling back up from the footer brings it back correctly).
  const sticky = $('#stickyCta');
  const inView = { form: true, footer: false };
  const refreshSticky = () => sticky.classList.toggle('show', !inView.form && !inView.footer && scrollY > 300);
  new IntersectionObserver(([en]) => { inView.form = en.isIntersecting; refreshSticky(); }).observe($('#give'));
  new IntersectionObserver(([en]) => { inView.footer = en.isIntersecting; refreshSticky(); }).observe($('.site-footer'));

  // ---------------------------------------------------------------- toasts (PRD 6.7)
  const toastsEl = $('#toasts');
  const FLAGS = { Australia: 'AU', Finland: 'FI', 'United States': 'US', Kenya: 'KE', Philippines: 'PH', Germany: 'DE',
    'New Zealand': 'NZ', Sweden: 'SE', 'United Kingdom': 'UK', Canada: 'CA', Nigeria: 'NG', Norway: 'NO' };
  function showToast({ icon, html, ttl = CFG.toasts.visibleMs }) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status');
    t.innerHTML = `<span class="t-icon" aria-hidden="true">${icon}</span><div>${html}</div><button class="t-x" aria-label="${esc(tr('toast.dismiss'))}">×</button>`;
    const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
    t.querySelector('.t-x').addEventListener('click', () => { close(); toastsDismissed = true; });
    toastsEl.appendChild(t);
    setTimeout(close, ttl);
  }
  let toastsDismissed = false; let shown = 0; const T = CFG.toasts; const MAX_TOASTS = T.maxPerVisit; let queue = []; const seen = []; // { sig, at }: gifts already queued

  function ago(m) {
    if (m < 2) return tr('ago.now');
    if (m < 60) return tr('ago.minutes', { n: m });
    if (m < 120) return tr('ago.hour');
    if (m < 1440) return tr('ago.hours', { n: Math.round(m / 60) });
    return m < 2880 ? tr('ago.yesterday') : tr('ago.days', { n: Math.round(m / 1440) });
  }
  function nextToast() {
    if (toastsDismissed || shown >= MAX_TOASTS || document.hidden) return;
    const item = queue.shift();
    if (!item) return;
    shown += 1;
    const code = /^[A-Z]{2}$/.test(item.country || '') ? item.country : null; // the real backend sends the country code
    let place = item.countryName;
    if (code) { try { place = new Intl.DisplayNames([I18N.lang, 'en'], { type: 'region' }).of(code) || place; } catch { /* keep the name sent */ } }
    const who = place ? trHtml('toast.someoneFrom', { country: place }) : tr('toast.someone');
    const just = item.minutesAgo < 60; // an older gift is not "just" given
    const money = fmt(item.amount, item.currency, item.amount % 1 ? 2 : 0);
    const what = trHtml(item.frequency === 'monthly' ? (just ? 'toast.justPledged' : 'toast.pledged') : (just ? 'toast.justGave' : 'toast.gave'), { money });
    showToast({ icon: code || FLAGS[item.countryName] || '♥', html: `${who} ${what}<small>${ago(item.minutesAgo)}</small>` });
  }
  function loadRecent() {
    return API.recent().then((d) => {
      // Drop anything malformed instead of rendering it (bad currency would also crash Intl)
      (Array.isArray(d && d.items) ? d.items : []).filter((it) => it && num(it.amount) > 0 && CURRENCIES.has(it.currency)
        && ['monthly', 'one-time'].includes(it.frequency) && (it.countryName == null || typeof it.countryName === 'string')
      ).forEach((it) => {
        // The feed only says "minutes ago", so a gift is recognised by what it was plus roughly
        // when it was made (in minutes since 1970). Within 3 minutes = the same gift seen again.
        const sig = [it.countryName, it.amount, it.frequency, it.currency].join('|');
        const at = Date.now() / 60000 - (num(it.minutesAgo) || 0);
        if (!seen.some((x) => x.sig === sig && Math.abs(x.at - at) <= 3)) { seen.push({ sig, at }); queue.push(it); }
      });
    }).catch(() => {});
  }
  // Real donations only, 8–15 s apart, max 5 per visit (PRD 6.7)
  setTimeout(function loop() {
    loadRecent().then(nextToast);
    if (shown < MAX_TOASTS && !toastsDismissed) setTimeout(loop, T.minGapMs + Math.random() * (T.maxGapMs - T.minGapMs));
  }, T.firstDelayMs);

  // ---------------------------------------------------------------- pathways (PRD 6.6)
  const dlg = $('#auDialog');
  $$('[data-open-au]').forEach((b) => b.addEventListener('click', () => {
    // A6: opening it again after a successful send gives a fresh, empty form
    if (!$('#auDone').hidden) { $('#auForm').reset(); $('#auForm').hidden = false; $('#auDone').hidden = true; clearAuErrors(); if (spamWidget && window.turnstile) window.turnstile.reset(spamWidget); }
    dlg.showModal(); $('input[name="name"]', dlg).focus(); loadSpamCheck();
  }));
  // A9: a clear message under each field that needs fixing
  const AU_RULES = {
    name: (v) => (v.length >= 2 ? '' : tr('field.nameRequired')),
    email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v) ? '' : tr('field.emailInvalid')),
    phone: (v) => (!v || (/^[+()\d\s.-]+$/.test(v) && (v.match(/\d/g) || []).length >= 6 && (v.match(/\d/g) || []).length <= 20) ? '' : tr('field.phoneInvalid')),
  };
  function fieldError(input, message) {
    let msg = input.parentElement.querySelector('.field-error');
    if (!msg) { msg = document.createElement('span'); msg.className = 'field-error'; msg.id = 'au-' + input.name + '-err'; input.after(msg); }
    msg.textContent = message; msg.hidden = !message;
    input.setAttribute('aria-invalid', String(!!message));
    if (message) input.setAttribute('aria-describedby', msg.id); else input.removeAttribute('aria-describedby');
    return !message;
  }
  function checkAuField(input) { const rule = AU_RULES[input.name]; return rule ? fieldError(input, rule(input.value.trim())) : true; }
  function clearAuErrors() { $$('#auForm input').forEach((i) => AU_RULES[i.name] && fieldError(i, '')); $('#auError').hidden = true; }
  $$('#auForm input').forEach((i) => {
    i.addEventListener('blur', () => { if (i.value.trim()) checkAuField(i); });
    i.addEventListener('input', () => { if (i.getAttribute('aria-invalid') === 'true') checkAuField(i); });
  });

  // Spam check (Cloudflare Turnstile): loaded only when the enquiry form is opened
  // and only if config.js has a site key. Its token is sent with the form.
  // With spamCheckOnGift it also guards the gift button, which stops stolen-card testing.
  let spamWidget = null; let giftWidget = null;
  // The Turnstile script is loaded once and shared by the country popup, the enquiry form and the gift button
  let turnstileLoad = null;
  function loadTurnstile() {
    if (turnstileLoad) return turnstileLoad;
    turnstileLoad = new Promise((resolve, reject) => {
      window.koivikkoTurnstileReady = () => resolve(window.turnstile);
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=koivikkoTurnstileReady';
      sc.async = true;
      sc.onerror = () => { turnstileLoad = null; reject(new Error('Spam check could not load')); };
      document.head.append(sc);
    });
    return turnstileLoad;
  }
  function loadSpamCheck() {
    if (!CFG.turnstileSiteKey || API.isMock || spamWidget !== null) return;
    spamWidget = false; // loading
    loadTurnstile().then((ts) => {
      spamWidget = ts.render('#auSpamCheck', { sitekey: CFG.turnstileSiteKey, language: I18N.lang });
      if (CFG.spamCheckOnGift) giftWidget = ts.render('#giftSpamCheck', { sitekey: CFG.turnstileSiteKey, language: I18N.lang });
    }).catch(() => { spamWidget = null; });
  }
  if (CFG.spamCheckOnGift) loadSpamCheck();
  $('#auForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formEl = e.target; const err = $('#auError'); err.hidden = true;
    const sendBtn = formEl.querySelector('button[type="submit"]');
    if (sendBtn.disabled) return; // A6: already sending
    // A9: check every field first and put the cursor on the first one to fix
    const bad = $$('input', formEl).filter((i) => AU_RULES[i.name] && !checkAuField(i));
    if (bad.length) { bad[0].focus(); return; }
    if (navigator.onLine === false) { err.textContent = tr('err.offline'); err.hidden = false; return; } // A10
    const fd = Object.fromEntries(new FormData(formEl));
    Object.keys(fd).forEach((k) => { if (typeof fd[k] === 'string') fd[k] = fd[k].trim(); });
    const label = sendBtn.textContent;
    sendBtn.disabled = true; sendBtn.setAttribute('aria-busy', 'true'); sendBtn.textContent = tr('au.sending');
    try {
      const { 'cf-turnstile-response': turnstileToken, ...fields } = fd;
      await API.contact({ ...fields, turnstileToken, utm });
      track('au_trust_enquiry');
      formEl.hidden = true; $('#auDone').hidden = false;
    } catch (ex) {
      err.textContent = ex.message || tr('au.sendFail'); err.hidden = false;
      if (spamWidget && window.turnstile) window.turnstile.reset(spamWidget); // a token works once
    } finally {
      sendBtn.disabled = false; sendBtn.removeAttribute('aria-busy'); sendBtn.textContent = label;
    }
  });

  // "Manage my gift": Stripe's own page for cancelling or changing the card
  $$('[data-manage]').forEach((b) => b.addEventListener('click', async () => {
    track('manage_gift_click');
    try {
      const u = new URL((await API.portal()).url);
      if (u.protocol !== 'https:' || u.hostname !== 'billing.stripe.com' || u.port || u.username || u.password) throw new Error('bad address');
      location.href = u.href;
    } catch { b.textContent = tr('manage.unavailable'); }
  }));
  // US donors go to oci.html first (explains the designation step), which then links out to OCI.
  // ---------------------------------------------------------------- bank details
  // The true bank details live in config.js. The page shows them and Copy always copies
  // the IBAN from config.js, never whatever is on screen, so an extension that alters
  // the text cannot change what the donor pastes into their bank.
  // (We do not watch the page for changes: browser translators and other honest
  // extensions edit the text too, and a warning would scare real donors.)
  const BANK = CFG.bank || { recipient: 'Koivikko Elämäntapa Instituutti sr', iban: 'FI11 5271 0420 4946 51' };
  if ($('#iban')) $('#iban').textContent = BANK.iban;
  if ($('#bankRecipient')) $('#bankRecipient').textContent = BANK.recipient;

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#copyIban')) return;
    // Copy the trusted IBAN from config.js, never whatever is currently on screen
    try { await navigator.clipboard.writeText(BANK.iban.replace(/\s/g, '')); $('#copyIban').textContent = tr('iban.copied'); }
    catch { $('#copyIban').textContent = tr('iban.select'); }
    track('iban_copy');
    setTimeout(() => { $('#copyIban').textContent = tr('iban.copy'); }, 2000);
  });
  // Started without errors: tell safe-mode.js not to pause giving
  window.KoivikkoAppReady = true;
})();
