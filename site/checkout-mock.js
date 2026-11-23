/* MOCKUP ONLY: preview of the Stripe Checkout step. Delete with checkout-mock.html when the backend is live. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const I18N = window.KoivikkoI18n || { lang: 'en', locale: 'en', t: (k) => k };
  const tr = I18N.t;
  const id = new URLSearchParams(location.search).get('session_id');
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const fail = () => { $('#err').hidden = false; $('#payForm').hidden = true; };

  KoivikkoApi.session(id).then((s) => {
    if (!s || !(s.amount > 0) || !/^[A-Z]{3}$/.test(s.currency || '')) return fail();
    let money;
    try { const f = new Intl.NumberFormat(I18N.locale, { style: 'currency', currency: s.currency }); money = (n) => f.format(n); } catch { return fail(); }
    const monthly = s.frequency === 'monthly';
    const total = money(s.amount);

    $('#label').textContent = tr(monthly ? 'co.monthlyLabel' : 'co.onceLabel');
    // Always name the currency: "$25.00" alone could be USD or AUD
    const head = $('#headline'); head.textContent = total + ' ';
    // Name the currency unless the number format already shows it (Finnish: "41,20 AUD")
    const code = total.includes(s.currency) ? '' : s.currency;
    head.append(el('small', [code, monthly ? tr('co.perMonth') : ''].filter(Boolean).join(' ')));

    const line = (label, sub, value, cls) => {
      const row = el('div', null, 'line' + (cls ? ' ' + cls : ''));
      const left = el('span', label); if (sub) left.append(el('small', sub));
      row.append(left, el('span', value)); return row;
    };
    const lines = $('#lines'); lines.textContent = '';
    lines.append(line(tr(monthly ? 'co.monthlyGift' : 'co.gift'), 'Koivikko Foundation', money(s.giftAmount ?? s.amount)));
    if (s.feeAmount > 0) lines.append(line(tr('co.fees'), tr('co.feesSub'), money(s.feeAmount)));
    lines.append(line(tr('co.total'), null, total, 'total'));

    if (monthly) {
      const next = new Date(); next.setMonth(next.getMonth() + 1);
      $('#renew').hidden = false;
      $('#renew').textContent = tr('co.renew', { total, date: next.toLocaleDateString(I18N.locale, { day: 'numeric', month: 'long' }) });
    }
    $('#pay').textContent = tr(monthly ? 'co.payMonthly' : 'co.payOnce', { total });
    $('#terms').textContent = tr(monthly ? 'co.termsMonthly' : 'co.termsOnce', { total });
    // Pre-select the country the donor told us in the "Where are you giving from?" popup
    let name = { AUD: 'Australia', USD: 'United States', EUR: 'Finland' }[s.currency];
    if (/^[A-Z]{2}$/.test(s.donorCountry || '')) {
      try { name = new Intl.DisplayNames(['en'], { type: 'region' }).of(s.donorCountry) || name; } catch { /* keep currency guess */ }
    }
    const sel = $('#country');
    if (name && ![...sel.options].some((o) => o.value === name)) sel.add(new Option(name, name), 0);
    if (name) sel.value = name;
  }).catch(fail);

  $('#payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('#pay'); b.setAttribute('aria-busy', 'true'); b.textContent = tr('co.processing');
    await KoivikkoApi.completeMockSession(id, $('#country').value);
    setTimeout(() => { location.href = 'thank-you.html?session_id=' + encodeURIComponent(id); }, 700);
  });
})();
