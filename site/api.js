/* ============================================================================
   Koivikko API client: the single seam between front end and backend.

   Every page calls window.KoivikkoApi.*. With KOIVIKKO_CONFIG.mockApi = true,
   the calls are answered in the browser with DEMO DATA. Otherwise they go to the
   real endpoints at KOIVIKKO_CONFIG.apiBase. The contract is in README.md.
   ============================================================================ */
(() => {
  'use strict';
  const cfg = window.KOIVIKKO_CONFIG || {};
  const base = (cfg.apiBase || '/api').replace(/\/$/, '');

  // Every call gives up after a time limit instead of leaving the donor waiting.
  async function http(path, { method = 'GET', body, timeoutMs = 10000 } = {}) {
    // A plain timer, because older browsers do not have AbortSignal.timeout.
    const stop = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = stop ? setTimeout(() => stop.abort(), timeoutMs) : null;
    let r;
    try {
      r = await fetch(base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: stop ? stop.signal : undefined,
      });
    } catch {
      const err = new Error(say('api.noAnswer', 'We could not reach our server. Please check your connection.'));
      err.noAnswer = true; // the server may or may not have received the call
      throw err;
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await r.json(); } catch { /* empty body */ }
    if (!r.ok) throw new Error((data && MESSAGES[data.error] && say('api.' + data.error, MESSAGES[data.error])) || say('api.generic', 'Something went wrong on our side.'));
    return data;
  }
  // The backend answers with short codes; these are the words the donor sees.
  // Translated wording when i18n.js has it, else the English below
  function say(key, english) { const I = window.KoivikkoI18n; const v = I && I.lang !== 'en' ? I.t(key) : key; return v === key ? english : v; }
  const MESSAGES = {
    invalid_amount: 'That amount is outside what we can accept.',
    invalid_currency: 'That currency is not available.',
    invalid_input: 'Please add your name and a valid email.',
    rate_limited: 'Too many attempts. Please wait a minute.',
    spam_check_failed: 'We could not confirm you are a person. Please tick the check again.',
    too_large: 'That message is too long. Please shorten it.',
    email_failed: 'We could not send your message just now. What you typed is still here: please try again in a minute.',
  };

  const real = {
    stats: () => http('/stats'),
    recent: () => http('/recent'),
    checkout: (body) => http('/checkout', { method: 'POST', body, timeoutMs: 30000 }),
    session: (id) => http('/session?session_id=' + encodeURIComponent(id)),
    contact: (body) => http('/contact', { method: 'POST', body }),
    // Link to Stripe's page where a donor cancels or changes their card
    portal: (sessionId) => http('/portal', { method: 'POST', body: sessionId ? { sessionId } : {} }),
  };

  /* ---------------------------------------------------------------- DEMO MODE
     DEMO DATA ONLY. The page must never show invented donations once it is live
     (PRD 6.7). Mock state is kept in sessionStorage so the counter goes up
     across pages after a simulated donation. */
  const KEY = 'k_mock_state_v1';
  const COUNTRIES = ['Australia', 'Finland', 'United States', 'Kenya', 'Philippines', 'Germany',
    'New Zealand', 'Sweden', 'United Kingdom', 'Canada', 'Nigeria', 'Norway'];
  const store = {
    get() {
      try { const s = JSON.parse(sessionStorage.getItem(KEY)); if (s) return s; } catch { /* blocked */ }
      const now = Date.now();
      const seed = [['Australia', 50, 'monthly', 3], ['Finland', 20, 'monthly', 9], ['United States', 100, 'monthly', 14],
        ['Kenya', 5, 'monthly', 22], [null, 35, 'one-time', 31], ['Philippines', 10, 'monthly', 47],
        ['Germany', 25, 'one-time', 63], ['New Zealand', 50, 'monthly', 88]];
      return {
        activeMonthlyDonors: 56, monthlyPledgedTotal: 1540, oneTimeThisMonth: 2310, currency: 'EUR', sessions: {},
        recent: seed.map(([countryName, amount, frequency, m]) => ({ countryName, amount, currency: 'EUR', frequency, at: now - m * 60000 })),
      };
    },
    set(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked */ } },
  };
  const delay = (v, ms = 250) => new Promise((r) => setTimeout(() => r(v), ms));
  const fail = (msg) => new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), 250));

  const mock = {
    stats() {
      const s = store.get();
      return delay({ activeMonthlyDonors: s.activeMonthlyDonors, monthlyPledgedTotal: Math.round(s.monthlyPledgedTotal),
        oneTimeThisMonth: Math.round(s.oneTimeThisMonth), currency: s.currency, updatedAt: new Date().toISOString() });
    },
    recent() {
      const s = store.get();
      if (Math.random() < 0.35) { // keep the demo feed alive
        const amounts = [5, 10, 20, 25, 50, 100];
        s.recent.unshift({ countryName: Math.random() < 0.12 ? null : COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)],
          amount: amounts[Math.floor(Math.random() * amounts.length)], currency: 'EUR',
          frequency: Math.random() < 0.7 ? 'monthly' : 'one-time', at: Date.now() - Math.floor(Math.random() * 4) * 60000 });
        s.recent = s.recent.slice(0, 10); store.set(s);
      }
      return delay({ items: s.recent.map((r) => ({ countryName: r.countryName, amount: r.amount, currency: r.currency,
        frequency: r.frequency, minutesAgo: Math.max(1, Math.round((Date.now() - r.at) / 60000)) })) });
    },
    checkout(b) {
      const lim = (cfg.limits || {})[b.currency];
      if (!lim || !['monthly', 'one-time'].includes(b.frequency)) return fail('Invalid currency or frequency.');
      if (!(b.amount >= lim[0] && b.amount <= lim[1])) return fail(`Please enter an amount between ${lim[0]} and ${lim[1]}.`);
      const s = store.get();
      const id = 'cs_test_mock_' + Math.random().toString(36).slice(2, 12);
      s.sessions[id] = { amount: b.amount, giftAmount: b.giftAmount ?? b.amount, feeAmount: b.feeAmount || 0,
        currency: b.currency, frequency: b.frequency, showCountry: b.showCountry === true,
        donorCountry: /^[A-Z]{2}$/.test(b.donorCountry || '') ? b.donorCountry : null };
      store.set(s);
      return delay({ url: 'checkout-mock.html?session_id=' + id }, 500);
    },
    session(id) {
      const x = store.get().sessions[id];
      return x ? delay({ amount: x.amount, giftAmount: x.giftAmount, feeAmount: x.feeAmount,
        currency: x.currency, frequency: x.frequency, donorCountry: x.donorCountry, paid: !!x.completed }) : fail('Not found');
    },
    contact(b) {
      if (b.leaveBlank) return delay({ ok: true }); // honeypot
      if (!b.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) return fail('Please add your name and a valid email.');
      return delay({ ok: true }, 500);
    },
    portal: () => fail('Managing a gift is not part of the demo.'),
    // Demo only: stands in for the Stripe webhook after the fake checkout "succeeds"
    completeMockSession(id, country) {
      const s = store.get(); const x = s.sessions[id];
      if (!x || x.completed) return delay({ ok: !!x });
      x.completed = true;
      if (x.frequency === 'monthly') { s.activeMonthlyDonors += 1; s.monthlyPledgedTotal += x.amount; } else s.oneTimeThisMonth += x.amount;
      s.recent.unshift({ countryName: x.showCountry ? country : null, amount: x.amount, currency: x.currency, frequency: x.frequency, at: Date.now() });
      s.recent = s.recent.slice(0, 10); store.set(s);
      return delay({ ok: true });
    },
  };

  window.KoivikkoApi = cfg.mockApi ? mock : real;
  window.KoivikkoApi.isMock = !!cfg.mockApi;
  // true while config.js still holds the placeholder backend address
  window.KoivikkoApi.notConfigured = !cfg.mockApi && /REPLACE-WITH/i.test(base);
})();
