/* ============================================================================
   Analytics + Google Ads conversions, only with the visitor's consent (GDPR).

   - Off by default: nothing loads and no banner shows until config.js has
     analytics.googleTagId (e.g. "G-XXXX" or "AW-XXXX"). In demo mode (?demo=1)
     the banner is shown as a preview, but Google NEVER loads, even with a tag id
     and consent, so demo gifts can't be counted as Google Ads conversions.
   - Google's script loads ONLY after the visitor taps "Accept" (consent first).
   - The page's own events (window.dataLayer: donate_click, checkout_started,
     donation_success, …) are forwarded to Google with safe fields only: never names or emails.
   - Google's tag uses its own data channel (window.kgDataLayer), so it cannot
     clash with the page's event list.
   Loaded in <head> after i18n.js; does its work once the page has loaded.
   ============================================================================ */
(() => {
  'use strict';
  const KEY = 'k_consent';
  const MAX_AGE_DAYS = 365; // ask again after a year
  const SAFE = ['amount', 'currency', 'frequency', 'location', 'channel', 'to', 'reason', 'where', 'fields',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];

  // Collect the page's events from the start (before we know whether to use them)
  const page = (window.dataLayer = window.dataLayer || []);
  const queue = page.slice();
  const push = page.push.bind(page);
  let forward = null;
  page.push = (...items) => { items.forEach((it) => (forward ? forward(it) : queue.push(it))); return push(...items); };

  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && (v.choice === 'granted' || v.choice === 'denied') && Date.now() - v.at < MAX_AGE_DAYS * 864e5) return v.choice;
    } catch { /* storage blocked: ask each visit */ }
    return null;
  };
  const save = (choice) => { try { localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() })); } catch { /* ignore */ } };

  function start() {
    const CFG = window.KOIVIKKO_CONFIG || {};
    const A = CFG.analytics || {};
    const id = /^(G|AW|GT)-[A-Z0-9-]{4,}$/i.test(A.googleTagId || '') ? A.googleTagId : '';
    // Demo mode is decided by config.js (mockApi), which ignores ?demo=1 on the live site
    const demo = location.protocol === 'file:' || CFG.mockApi === true;
    if (!id && !(demo && A.previewBannerInDemo !== false)) return; // analytics switched off
    const I = window.KoivikkoI18n || { lang: 'en', t: (k) => k };
    const t = (k, en) => { const v = I.t(k); return v === k ? en : v; };

    // ------------------------------------------------------------ Google tag (after consent only)
    let loaded = false;
    function loadGoogle() {
      if (loaded || !id || demo) return; // demo data: never send anything to Google
      loaded = true;
      const g = (window.kgDataLayer = window.kgDataLayer || []);
      const gtag = function () { g.push(arguments); };
      window.kgtag = gtag;
      gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'granted' });
      gtag('js', new Date());
      gtag('config', id, { anonymize_ip: true });
      if (A.adsId && A.adsId !== id) gtag('config', A.adsId);
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id) + '&l=kgDataLayer';
      document.head.append(s);
      forward = send;
      queue.splice(0).forEach(send);
    }
    function send(item) {
      if (!item || typeof item !== 'object' || typeof item.event !== 'string' || !window.kgtag) return;
      const params = {};
      SAFE.forEach((k) => { if (item[k] != null && String(item[k]).length < 120) params[k] = item[k]; });
      if (typeof params.amount === 'number') params.value = params.amount;
      window.kgtag('event', item.event, params);
      // A completed donation is the Google Ads conversion
      if (item.event === 'donation_success' && A.adsConversion) {
        window.kgtag('event', 'conversion', { send_to: A.adsConversion, value: params.value, currency: params.currency });
      }
    }

    // ------------------------------------------------------------ banner
    const privacy = I.lang === 'fi' ? 'https://koivikko.org/policies/privacy-policy' : 'https://koivikko.org/en/policies/privacy-policy';
    let banner = null;
    function showBanner() {
      if (banner) { banner.hidden = false; layout(); banner.querySelector('button').focus(); return; }
      banner = document.createElement('section');
      banner.className = 'consent'; banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', t('consent.title', 'Cookies'));
      const p = document.createElement('p');
      p.textContent = t('consent.text', 'We’d like to use cookies to see which ads and pages help people find Koivikko. Nothing is used unless you agree.') + ' ';
      const more = document.createElement('a');
      more.href = privacy; more.textContent = t('consent.more', 'Privacy policy'); more.rel = 'noopener';
      p.append(more);
      const row = document.createElement('div'); row.className = 'consent-buttons';
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn btn-primary btn-sm'; yes.textContent = t('consent.accept', 'Accept');
      const no = document.createElement('button'); no.type = 'button'; no.className = 'btn btn-outline btn-sm'; no.textContent = t('consent.decline', 'Decline');
      // Equal choice (GDPR): same size, side by side, no pre-ticked option
      row.append(no, yes);
      banner.append(p, row);
      document.body.append(banner);
      const choose = (choice) => {
        save(choice); banner.hidden = true; layout();
        (window.dataLayer || []).push({ event: 'consent_' + choice });
        if (choice === 'granted') loadGoogle();
      };
      yes.addEventListener('click', () => choose('granted'));
      no.addEventListener('click', () => choose('denied'));
      layout();
    }
    // Keep the live pop-ups and the mobile Donate bar clear of the banner
    function layout() {
      const h = banner && !banner.hidden ? banner.offsetHeight : 0;
      document.documentElement.style.setProperty('--consent-h', h + 'px');
      document.documentElement.classList.toggle('consent-open', h > 0);
    }
    addEventListener('resize', () => banner && layout());

    // "Cookie settings" link in the footer reopens the choice
    document.querySelectorAll('[data-consent-settings]').forEach((b) => {
      b.hidden = false;
      b.addEventListener('click', () => showBanner());
    });

    const choice = read();
    if (choice === 'granted') loadGoogle();
    else if (choice !== 'denied') showBanner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
