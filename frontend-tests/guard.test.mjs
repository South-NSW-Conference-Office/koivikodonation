// Bank details + console scam warning.
// The page no longer watches itself for changes (browser translators edit text too, and a
// "tampered" warning would scare honest donors). What is checked instead:
//   - the console warning, Copy always copying the trusted IBAN, translate="no" on the details,
//   - and that a translator-style edit never produces a warning.
import { launch, openPage } from './cdp.mjs';
const B = process.env.BASE || 'http://localhost:3001';
const REAL = 'FI11 5271 0420 4946 51';
const REC = `window.__logs = []; const _l = console.log.bind(console); console.log = (...a) => { window.__logs.push(a.join(' ')); _l(...a); };
  window.__copied = null; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } } }); } catch (e) {}
  try { sessionStorage.setItem('k_demo', '1'); localStorage.setItem('k_country', 'FI'); } catch (e) {}`;
let fails = 0; const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, typeof d === 'string' ? d : JSON.stringify(d)); };
const b = await launch();
const fresh = async (path = '/?demo=1&lang=en', wait = 3000) => { const p = await openPage(b, { initScript: REC }); await p.goto(B + path, wait); return p; };
try {
  // 1. console warning on every page, in the page language
  for (const page of ['/?demo=1', '/thank-you.html', '/donate-cancelled.html', '/oci.html', '/checkout-mock.html?session_id=x']) {
    for (const lang of ['en', 'fi']) {
      const p = await fresh(page + (page.includes('?') ? '&' : '?') + 'lang=' + lang, 2500);
      const logs = await p.eval(`return window.__logs`);
      const want = lang === 'en' ? /Stop!/ : /Seis!/;
      R(logs.some((l) => want.test(l)) && logs.some((l) => (lang === 'en' ? /scam/ : /huijauksesta/).test(l)), `Console warning (${lang}) on ${page}`);
      await p.close();
    }
  }
  for (const lang of ['en', 'fi']) {
    const p = await fresh('/?demo=1&lang=' + lang);
    // 2. the details shown come from config.js, and translators are told to leave them alone
    let r = await p.eval(`return { iban: document.getElementById('iban').textContent, rec: document.getElementById('bankRecipient').textContent,
      noTranslate: ['iban', 'bankRecipient'].every((id) => document.getElementById(id).getAttribute('translate') === 'no') }`);
    R(r.iban === REAL && r.rec === 'Koivikko Elämäntapa Instituutti sr' && r.noTranslate, `(${lang}) Bank details shown from config.js, marked translate="no"`, r);
    // 3. Copy copies the trusted IBAN even when the screen shows something else
    r = await p.eval(`document.getElementById('iban').textContent = 'GB00 SCAM 0000'; document.getElementById('copyIban').click(); await new Promise(r => setTimeout(r, 300)); return { copied: window.__copied }`);
    R(r.copied === REAL.replace(/\s/g, ''), `(${lang}) Copy copies the trusted IBAN (not the screen)`, r);
    // 4. a translator-style edit (account name translated, text wrapped in <font>) gives no warning
    r = await p.eval(`const rec = document.getElementById('bankRecipient'); rec.innerHTML = '<font>Koivikko Lifestyle Institute</font>';
      document.querySelectorAll('h2').forEach((h) => { h.innerHTML = '<font>' + h.textContent + '</font>'; });
      await new Promise(r => setTimeout(r, 500));
      return { alerts: document.querySelectorAll('[role=alert]:not([hidden])').length, note: !!document.querySelector('.guard-note'),
        tamper: (window.dataLayer || []).filter(e => e.event === 'tamper_restored').length }`);
    R(!r.note && r.tamper === 0, `(${lang}) Translator-style edits cause no warning`, r);
    const warns = p.log.console.filter((c) => /payment details|tilitiedot|maksutiedot/i.test(c));
    R(!warns.length, `(${lang}) No tamper warnings in the console`, warns);
    if (p.log.exceptions.length) R(false, `(${lang}) No JS errors`, p.log.exceptions);
    await p.close();
  }
} finally { b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(0); }
