// Checks for the payment/security audit fixes (20 Nov 2026) and the thank-you page additions.
import { launch, openPage, sleep } from './cdp.mjs';
const B = process.env.BASE || 'http://localhost:3001';
let fails = 0; const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, typeof d === 'string' ? d : JSON.stringify(d)); };
const sessionIs = (sess) => `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) { v.session = async () => (${JSON.stringify(sess)}); Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });`;
const waitContinue = `await new Promise(r => { const t0 = Date.now(); (function w() { if (!document.getElementById('countryContinue').disabled || Date.now() - t0 > 6000) r(); else setTimeout(w, 100); })(); });`;
const b = await launch();
try {
  // Fix 1: duplicate submission
  let p = await openPage(b);
  await p.goto(B + '/?lang=en', 3000);
  let r = await p.eval(`let calls = 0; const ids = new Set(); KoivikkoApi.checkout = (x) => { calls++; ids.add(x.attemptId); return new Promise(() => {}); };
    const f = document.getElementById('donateForm'); for (let i = 0; i < 5; i++) f.requestSubmit();
    for (let i = 0; i < 5; i++) document.getElementById('donateBtn').click();
    f.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 300)); return { calls, ids: ids.size, busy: document.getElementById('donateBtn').getAttribute('aria-busy'), disabled: document.getElementById('donateBtn').disabled }`);
  R(r.calls === 1 && r.busy === 'true' && r.disabled, 'Fix 1: 5 submits + 5 clicks + Enter → exactly one checkout call; button stays locked', r);
  r = await p.eval(`KoivikkoApi.checkout = () => Promise.reject(Object.assign(new Error('Server busy.'), {})); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await new Promise(r => setTimeout(r, 100)); let calls = 0; KoivikkoApi.checkout = () => { calls++; return Promise.reject(new Error('Server busy.')); };
    document.getElementById('donateBtn').click(); await new Promise(r => setTimeout(r, 200)); const afterFail = !document.getElementById('donateBtn').disabled;
    document.getElementById('donateBtn').click(); await new Promise(r => setTimeout(r, 200)); return { calls, afterFail }`);
  R(r.calls === 2 && r.afterFail, 'Fix 1: back with Back button → can give again; after a failure → can retry', r);
  await p.close();

  // Fix 2: thank-you only trusts a confirmed payment
  for (const [sess, wantAmount, label] of [[{ amount: 40, currency: 'AUD', frequency: 'monthly' }, false, 'no "paid" field'], [{ amount: 40, currency: 'AUD', frequency: 'monthly', paid: false }, false, 'paid: false'],
    [{ amount: 40, currency: 'AUD', frequency: 'monthly', paid: 'yes' }, false, 'paid: "yes" (not true)'], [{ amount: 40, currency: 'AUD', frequency: 'monthly', paid: true }, true, 'paid: true']]) {
    p = await openPage(b, { initScript: sessionIs(sess) });
    await p.goto(B + '/thank-you.html?session_id=cs_test_x&lang=en', 2500);
    r = await p.eval(`return { gift: document.getElementById('gift').textContent, success: (window.dataLayer || []).some(e => e.event === 'donation_success') }`);
    const shows = /A\$40\.00/.test(r.gift);
    R(shows === wantAmount && r.success === wantAmount, `Fix 2: session ${label} → ${wantAmount ? 'amount + donation recorded' : 'generic thanks, nothing recorded'}`, r);
    await p.close();
  }

  // Fix 3: monthly fee says it repeats (EN + FI); one-time does not
  for (const lang of ['en', 'fi']) {
    p = await openPage(b);
    await p.goto(B + '/?lang=' + lang, 3000);
    r = await p.eval(`const line = () => document.getElementById('coverFees').closest('label').textContent.replace(/\\s+/g, ' ').trim();
      document.querySelector('label[for=f-monthly]').click(); const m = line(); document.querySelector('label[for=f-once]').click(); const o = line(); return { monthly: m, once: o }`);
    const ok = lang === 'en' ? /each month to help cover card fees/.test(r.monthly) && !/each month/.test(r.once) : /kuukausittain korttimaksujen/.test(r.monthly) && !/kuukausittain/.test(r.once);
    R(ok, `Fix 3 (${lang}): monthly fee line says it repeats; one-time doesn't`, r);
    await p.close();
  }

  // Fix 4: country change after choosing an amount → notice; no notice when nothing was chosen
  p = await openPage(b);
  await p.goto(B + '/?lang=en', 3000);
  r = await p.eval(`const pick = async (c) => { document.getElementById('changeCountry').click(); await new Promise(r => setTimeout(r, 200)); document.getElementById('countrySelect').value = c; ${waitContinue} document.getElementById('countryForm').requestSubmit(); };
    await pick('AU'); const untouched = document.getElementById('curChangeNote').hidden;
    document.querySelectorAll('.amt')[5].click(); const o = document.getElementById('otherAmount'); o.value = '50'; o.dispatchEvent(new Event('input'));
    await pick('FI'); const n = document.getElementById('curChangeNote');
    const shown = { hidden: n.hidden, text: n.textContent, label: document.getElementById('donateLabel').textContent };
    await pick('DE'); const sameCurrency = n.hidden;   // FI → DE: both EUR, nothing changed
    document.querySelectorAll('.amt')[1].click(); const afterPick = n.hidden;
    return { untouched, shown, sameCurrency, afterPick }`);
  R(r.untouched && !r.shown.hidden && /now in € EUR/.test(r.shown.text) && r.sameCurrency && r.afterPick, 'Fix 4: notice only when a chosen amount changes currency; disappears on the next choice', r);
  await p.close();
  p = await openPage(b);
  await p.goto(B + '/?lang=fi', 3000);
  r = await p.eval(`document.querySelectorAll('.amt')[2].click(); document.getElementById('changeCountry').click(); await new Promise(r => setTimeout(r, 200)); document.getElementById('countrySelect').value = 'AU'; ${waitContinue} document.getElementById('countryForm').requestSubmit();
    return document.getElementById('curChangeNote').textContent`);
  R(/Lahjasi on nyt valuutassa A\$ AUD/.test(r), 'Fix 4 (fi): notice in Finnish', r);
  await p.close();

  // Fix 5: 200% zoom (1366 laptop → 683 CSS px; phone 390 → 195 is below the 320 we support, so test 360@~200% = 180? use 320 as WCAG reflow floor)
  for (const [w, h, label] of [[683, 384, 'laptop at 200%'], [640, 360, '1280 screen at 200%'], [320, 400, 'WCAG reflow (400%)']]) {
    p = await openPage(b, { width: w, height: h });
    await p.goto(B + '/?lang=en', 3000);
    r = await p.eval(`const btn = document.getElementById('donateBtn'); const lbl = document.getElementById('donateLabel'); btn.scrollIntoView({ block: 'center' });
      const fee = document.getElementById('coverFees').closest('label');
      return { hScroll: document.documentElement.scrollWidth > innerWidth, labelFits: lbl.scrollWidth <= btn.clientWidth, label: lbl.textContent,
        monthlyChecked: document.getElementById('f-monthly').checked, freqVisible: document.querySelector('label[for=f-monthly]').getBoundingClientRect().width > 0,
        feeFits: fee.scrollWidth <= fee.clientWidth + 1 }`);
    R(!r.hScroll && r.labelFits && /monthly/.test(r.label) && r.freqVisible && r.feeFits, `Fix 5: ${label} (${w}px): final charge + "monthly" fully visible, no sideways scroll`, r);
    await p.close();
  }

  // Thank-you page: tour invitation and "give again" (EN + FI)
  for (const lang of ['en', 'fi']) {
    p = await openPage(b, { initScript: sessionIs({ amount: 40, currency: 'AUD', frequency: 'monthly', paid: true }) });
    await p.goto(B + '/thank-you.html?session_id=cs_test_x&lang=' + lang, 2500);
    r = await p.eval(`const t = document.getElementById('tourLink'); const g = document.getElementById('giveAgain');
      t.addEventListener('click', e => e.preventDefault()); g.addEventListener('click', e => e.preventDefault()); t.click(); g.click();
      return { tourHref: t.getAttribute('href'), tourText: t.textContent.trim(), title: document.querySelector('.tour-title').textContent, again: g.getAttribute('href'), againText: g.textContent,
        events: (window.dataLayer || []).map(e => e.event).filter(e => /tour|again/.test(e)) }`);
    const ok = lang === 'en'
      ? r.tourHref === 'https://koivikko.org/en' && /Take a tour of koivikko\.org/.test(r.tourText) && /Come and see/.test(r.title) && /Back to the donation page/.test(r.againText)
      : r.tourHref === 'https://koivikko.org/' && /Tutustu sivustoon koivikko\.org/.test(r.tourText) && /Tule katsomaan/.test(r.title) && /Takaisin lahjoitussivulle/.test(r.againText);
    R(ok && r.again === 'index.html#give' && r.events.includes('tour_click') && r.events.includes('give_again_click'), `Thank-you (${lang}): tour of koivikko.org + link back to give again`, r);
    await p.close();
  }
  // "give again" lands on the form, in the same language
  p = await openPage(b);
  await p.goto(B + '/thank-you.html?lang=fi', 2000);
  await p.eval(`document.getElementById('giveAgain').click(); return 1`);
  await sleep(2500);
  r = await p.eval(`return { path: location.pathname, hash: location.hash, lang: document.documentElement.lang, form: !!document.getElementById('donateForm') }`);
  R(r.path.endsWith('index.html') && r.hash === '#give' && r.lang === 'fi' && r.form, '"Back to the donation page" opens the gift form, language kept', r);
  await p.close();
} finally { b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(0); }
