import { launch, openPage, sleep } from './cdp.mjs';
const B = process.env.BASE || 'http://localhost:3001';
let fails = 0; const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, typeof d === 'string' ? d : JSON.stringify(d)); };
const DEMO = `try { sessionStorage.setItem('k_demo','1') } catch (e) {}`;
const FRESH = `if (!sessionStorage.getItem('__f')) { try { localStorage.clear() } catch (e) {} sessionStorage.setItem('__f','1') } ` + DEMO;
const RETURNING = DEMO + ` try { localStorage.setItem('k_country','FI') } catch (e) {}`;
const cfg = (patch) => `Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true, set(v) { Object.assign(v, ${patch}); Object.defineProperty(window, 'KOIVIKKO_CONFIG', { value: v, writable: true }); } });`;
const stats = (fn) => `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) { v.stats = ${fn}; Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });`;
const b = await launch();
try {
  // A1: Google Ads visitor → no popup, guess applied, Change available
  let p = await openPage(b, { fresh: true, initScript: FRESH });
  await p.goto(B + '/?lang=en&gclid=TeSt123', 3000);
  let r = await p.eval(`return { open: document.getElementById('countryDialog').open, from: document.getElementById('givingFrom').hidden ? null : document.getElementById('countryName').textContent, ev: (window.dataLayer||[]).find(e => e.event === 'country_popup_skipped') }`);
  R(!r.open && !!r.from && r.ev && r.ev.reason === 'ad', 'A1 Google Ads click: no popup, country guessed, "Change" shown', r);
  await p.close();
  p = await openPage(b, { fresh: true, initScript: FRESH });
  await p.goto(B + '/?lang=en', 3000);
  R(await p.eval(`return document.getElementById('countryDialog').open`), 'A1 normal first visit still asks');
  await p.close();
  // A4: visitor taps an amount before the popup's moment → no interruption
  p = await openPage(b, { fresh: true, initScript: FRESH });
  await p.cmd('Page.navigate', { url: B + '/?lang=en' });
  await sleep(500);
  await p.eval(`document.querySelectorAll('.amt')[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelectorAll('.amt')[2].click(); return 1`);
  await sleep(2000);
  r = await p.eval(`return { open: document.getElementById('countryDialog').open, ev: (window.dataLayer||[]).find(e => e.event === 'country_popup_skipped') }`);
  R(!r.open && r.ev && r.ev.reason === 'busy', 'A4 already choosing a gift: popup does not interrupt', r);
  await p.close();

  // A2: early counter (below 20) in EN and FI, numbers hidden everywhere
  for (const lang of ['en', 'fi']) {
    p = await openPage(b, { initScript: RETURNING + stats(`async () => ({ activeMonthlyDonors: 2, monthlyPledgedTotal: 49, currency: 'EUR' })`) });
    await p.goto(B + '/?lang=' + lang, 3000);
    r = await p.eval(`return { early: document.getElementById('counterEarly').textContent, lineHidden: document.querySelector('.counter-line').hidden, progressHidden: document.getElementById('progressWrap').hidden,
      nextHidden: document.getElementById('nextNum').hidden, sticky: document.getElementById('stickyCount').textContent, counterVisible: !document.getElementById('counter').hidden }`);
    const want = lang === 'en' ? /Be one of our first 100 monthly supporters/ : /Ole yksi ensimmäisistä 100 kuukausitukijastamme/;
    R(r.counterVisible && want.test(r.early) && r.lineHidden && r.progressHidden && r.nextHidden && !/\b2\b/.test(r.sticky), `A2 early counter (${lang}): invitation instead of "2 people", no small numbers anywhere`, r);
    await p.close();
  }
  p = await openPage(b, { initScript: RETURNING });
  await p.goto(B + '/?lang=en', 3500);
  r = await p.eval(`return { line: document.querySelector('.counter-line').textContent.replace(/\\s+/g,' ').trim(), early: document.getElementById('counterEarly').hidden }`);
  R(/^56 people are pledging a combined A\$2,695/.test(r.line) && r.early, 'A2 above the threshold: normal counter', r);
  await p.close();

  // A3: refresh updates numbers without reloading; failed refresh keeps last numbers
  p = await openPage(b, { initScript: RETURNING + cfg(`{ counterRefreshSeconds: 15 }`) + `window.__n = 30;` + stats(`async () => { window.__calls = (window.__calls||0) + 1; if (window.__calls === 3) throw new Error('down'); return { activeMonthlyDonors: window.__n, monthlyPledgedTotal: window.__n * 20, currency: 'AUD' }; }`) });
  await p.goto(B + '/?lang=en', 3500);
  const n1 = await p.eval(`return document.querySelector('[data-count="donors"]').textContent`);
  await p.eval(`window.__n = 31; return 1`);
  await sleep(16000);
  const n2 = await p.eval(`return { donors: document.querySelector('[data-count="donors"]').textContent, total: document.querySelector('[data-count="total"]').textContent, calls: window.__calls }`);
  await sleep(15500);
  const n3 = await p.eval(`return { donors: document.querySelector('[data-count="donors"]').textContent, hidden: document.getElementById('counter').hidden, calls: window.__calls }`);
  R(n1 === '30' && n2.donors === '31' && n2.total === 'A$620' && n3.calls >= 3 && n3.donors === '31' && !n3.hidden, 'A3 counter refreshes live; a failed refresh keeps the last numbers', { n1, n2, n3 });
  await p.close();

  // A5 + A9: amount formats and the message under the field
  p = await openPage(b, { initScript: RETURNING + cfg(`{ counterMinDonors: 1 }`) });
  await p.goto(B + '/?lang=en', 3000);
  await p.eval(`window.__sent = []; KoivikkoApi.checkout = async (x) => { __sent.push(x); throw new Error('captured'); }; document.querySelector('label[for=f-monthly]').click(); const c=document.getElementById('currency'); c.value='EUR'; c.dispatchEvent(new Event('change')); return 1`);
  const cases = [['12,50', 12.5], ['12.50', 12.5], ['1,000', 1000], ['1.000', 1000], ['1 000', 1000], ['€50', 50], ['50 EUR', 50], ['A$40', 40], ['25', 25],
    ['-5', null], ['1e3', null], ['abc', null], ['1', 'range'], ['20000', 'range'], ['12,5', 12.5], ['12.345', 'range']];
  for (const [v, want] of cases) {
    r = await p.eval(`document.querySelectorAll('.amt')[5].click(); const o = document.getElementById('otherAmount'); o.value = ${JSON.stringify(v)}; o.dispatchEvent(new Event('input'));
      const before = __sent.length; document.getElementById('donateBtn').click(); await new Promise(r => setTimeout(r, 80));
      const fe = document.getElementById('otherError');
      return { label: document.getElementById('donateLabel').textContent, fieldErr: fe.hidden ? '' : fe.textContent, invalid: o.getAttribute('aria-invalid'), sent: __sent.length > before ? __sent[__sent.length - 1].giftAmount : null }`);
    let ok;
    if (typeof want === 'number') ok = r.sent === want && !r.fieldErr && r.invalid === 'false';
    else if (want === 'range') ok = r.sent === null && /between/.test(r.fieldErr) && r.invalid === 'true';
    else ok = r.sent === null && /as a number/.test(r.fieldErr) && r.label === 'Choose an amount';
    R(ok, `A5/A9 Other amount "${v}" → ${want === null ? 'format message' : want}`, r);
  }
  // A7: upsell never bigger than the one-time gift
  const ups = await p.eval(`document.querySelector('label[for=f-once]').click(); const out = {};
    for (const v of ['5', '15', '60', '600']) { document.querySelectorAll('.amt')[5].click(); const o = document.getElementById('otherAmount'); o.value = v; o.dispatchEvent(new Event('input'));
      out[v] = document.getElementById('nudge').hidden ? 'hidden' : Number(document.getElementById('nudgeBtn').dataset.amount); } return out`);
  R(ups['5'] === 'hidden' && ups['15'] <= 15 && ups['60'] <= 60 && ups['600'] <= 600, 'A7 upsell never suggests more than the gift (€5 → none)', ups);
  // A10: offline → immediate message with bank-transfer link; banner appears/disappears
  await p.cmd('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(300);
  r = await p.eval(`document.querySelector('label[for=f-monthly]').click(); document.querySelectorAll('.amt')[1].click(); const before = __sent.length; document.getElementById('donateBtn').click(); await new Promise(r => setTimeout(r, 100));
    const e = document.getElementById('formError'); const n = document.querySelector('.net-note');
    return { err: e.hidden ? '' : e.textContent, link: !!e.querySelector('a[href="#ways"]'), banner: n && !n.hidden ? n.textContent : '', sent: __sent.length > before }`);
  R(/offline/.test(r.err) && r.link && /offline/.test(r.banner) && !r.sent, 'A10 offline: clear message + bank-transfer link + banner, nothing sent', r);
  await p.cmd('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(300);
  R(await p.eval(`return document.querySelector('.net-note').hidden`), 'A10 banner disappears when back online');
  await p.close();
  // A10: slow checkout → "Still working…" after 8 s; server unreachable → bank link
  p = await openPage(b, { initScript: RETURNING });
  await p.goto(B + '/?lang=en', 3000);
  r = await p.eval(`KoivikkoApi.checkout = () => new Promise((res, rej) => setTimeout(() => { const e = new Error('We could not reach our server. Please check your connection.'); e.noAnswer = true; rej(e); }, 9500));
    document.getElementById('donateBtn').click(); await new Promise(r => setTimeout(r, 8600)); const slow = document.getElementById('donateLabel').textContent;
    await new Promise(r => setTimeout(r, 1500)); const e = document.getElementById('formError');
    return { slow, err: e.textContent, link: !!e.querySelector('a[href="#ways"]'), btnEnabled: !document.getElementById('donateBtn').disabled }`);
  R(/Still working/.test(r.slow) && /Nothing was charged/.test(r.err) && r.link && r.btnEnabled, 'A10 slow then unreachable: "Still working…", then message + bank link', r);
  await p.close();

  // A6 + A9: Australian form
  p = await openPage(b, { initScript: RETURNING });
  await p.goto(B + '/?lang=en', 3000);
  r = await p.eval(`document.querySelector('[data-open-au]').click(); const f = document.getElementById('auForm'); f.requestSubmit(); await new Promise(r => setTimeout(r, 100));
    const errs = [...f.querySelectorAll('.field-error')].filter(e => !e.hidden).map(e => e.textContent);
    return { errs, focus: document.activeElement.name, nameInvalid: f.name.getAttribute('aria-invalid'), described: f.name.getAttribute('aria-describedby') }`);
  R(r.errs.length === 2 && r.focus === 'name' && r.nameInvalid === 'true' && !!r.described, 'A9 AU form: messages under name + email, cursor on first field', r);
  r = await p.eval(`const f = document.getElementById('auForm'); f.name.value = 'Jo'; f.email.value = 'jo@example'; f.phone.value = 'call me'; f.requestSubmit(); await new Promise(r => setTimeout(r, 100));
    return [...f.querySelectorAll('.field-error')].filter(e => !e.hidden).map(e => e.textContent)`);
  R(r.length === 2 && r.some((t) => /email/.test(t)) && r.some((t) => /phone/.test(t)), 'A9 AU form: bad email and bad phone each explained', r);
  r = await p.eval(`let calls = 0; KoivikkoApi.contact = (x) => { calls++; window.__contact = x; return new Promise(r => setTimeout(() => r({ ok: true }), 600)); };
    const f = document.getElementById('auForm'); f.name.value = '  Jo Smith  '; f.email.value = 'jo@example.com'; f.phone.value = '+61 400 123 456';
    f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); await new Promise(r => setTimeout(r, 100));
    const btn = f.querySelector('button[type=submit]'); const during = { disabled: btn.disabled, text: btn.textContent };
    await new Promise(r => setTimeout(r, 800));
    return { calls, during, done: !document.getElementById('auDone').hidden, trimmed: window.__contact.name }`);
  R(r.calls === 1 && r.during.disabled && /Sending/.test(r.during.text) && r.done && r.trimmed === 'Jo Smith', 'A6 AU form: locked while sending (3 clicks → 1 send), trimmed input', r);
  r = await p.eval(`document.getElementById('auDialog').close(); document.querySelector('[data-open-au]').click();
    const f = document.getElementById('auForm'); return { formShown: !f.hidden, doneHidden: document.getElementById('auDone').hidden, empty: f.name.value === '' && f.email.value === '', btn: f.querySelector('button[type=submit]').textContent }`);
  R(r.formShown && r.doneHidden && r.empty && r.btn === 'Send my details', 'A6 AU form: reopening gives a fresh empty form', r);
  await p.close();

  // Finnish wording of the new messages
  p = await openPage(b, { initScript: RETURNING });
  await p.goto(B + '/?lang=fi', 3000);
  r = await p.eval(`document.querySelectorAll('.amt')[5].click(); const o = document.getElementById('otherAmount'); o.value = 'abc'; o.dispatchEvent(new Event('input'));
    const fmtMsg = document.getElementById('otherError').textContent; o.value = '12,50'; o.dispatchEvent(new Event('input'));
    document.querySelector('[data-open-au]').click(); document.getElementById('auForm').requestSubmit(); await new Promise(r => setTimeout(r, 100));
    return { fmtMsg, label: document.getElementById('donateLabel').textContent, auErr: document.querySelector('#auForm .field-error').textContent }`);
  R(/numerona/.test(r.fmtMsg) && /12,50/.test(r.label) && /Kirjoita nimesi/.test(r.auErr), 'Finnish: new messages translated, "12,50" accepted', r);
  if (p.log.exceptions.length) R(false, 'No JS errors', p.log.exceptions);
  await p.close();
} finally { b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(0); }
