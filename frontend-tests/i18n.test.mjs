import { launch, openPage, sleep } from './cdp.mjs';
import { readFileSync } from 'node:fs';
const B = process.env.BASE || 'http://localhost:3001';
const english = JSON.parse(readFileSync(new URL('./strings.json', import.meta.url), 'utf8'));
const KEEP = new Set(['Koivikko', 'EN', 'FI', '€ EUR', 'A$ AUD', '$ USD', 'AU', 'US', 'Koivikko Elämäntapa Instituutti sr', 'IBAN', '— Emily', '— Veera',
  'koivikkolife@gmail.com', 'Koivikko Lifestyle Center', 'Terveyskoulukoti Oy', 'Rahankeräyslupa RA/2021/1553 (Poliisihallitus 16.11.2021)', 'Facebook', 'Instagram',
  'WhatsApp', 'Koivikko Lifestyle Institute', 'Apple Pay', 'Google Pay', 'you@example.com', 'VISA · MC · AMEX', '1234 1234 1234 1234', 'MM / YY', 'CVC',
  'Australia', 'Finland', 'United States', 'Kenya', 'Philippines', 'Germany', 'New Zealand', 'United Kingdom', 'Give €25 monthly', 'English', 'Suomi']);
const leftovers = `const EN = new Set(${JSON.stringify(english.filter((s) => !KEEP.has(s)))}); const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; const v = n.nodeValue.replace(/\\s+/g,' ').trim(); if (v && EN.has(v) && !n.parentElement.closest('script,style,noscript')) out.push(v); }
  document.querySelectorAll('[aria-label],[alt],[placeholder]').forEach(e => ['aria-label','alt','placeholder'].forEach(a => { const v = (e.getAttribute(a)||'').trim(); if (EN.has(v)) out.push(a + ': ' + v); }));
  return out;`;
const FRESH = `if (!sessionStorage.getItem('__f')) { try { localStorage.clear() } catch (e) {} sessionStorage.setItem('__f','1') }`;
let fails = 0; const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, typeof d === 'string' ? d : JSON.stringify(d)); };
const AXE = await fetch('https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js').then((r) => r.text());
const b = await launch();
try {
  // 1. Finnish: every page fully translated
  for (const page of ['/?demo=1', '/thank-you.html', '/donate-cancelled.html', '/oci.html', '/checkout-mock.html?session_id=x']) {
    const p = await openPage(b, { initScript: `try { sessionStorage.setItem('k_demo','1') } catch (e) {}` });
    await p.goto(B + page + (page.includes('?') ? '&' : '?') + 'lang=fi', 3500);
    const left = await p.eval(leftovers);
    const info = await p.eval(`return { lang: document.documentElement.lang, title: document.title, hidden: getComputedStyle(document.body).visibility }`);
    R(info.lang === 'fi' && !left.length && info.hidden === 'visible', `FI ${page}: no English left, page visible`, left.length ? left.slice(0, 8) : info.title);
    if (p.log.exceptions.length) R(false, `FI ${page}: no JS errors`, p.log.exceptions);
    await p.close();
  }
  // 2. English untouched
  const e = await openPage(b);
  await e.goto(B + '/?demo=1&lang=en', 3000);
  const en = await e.eval(`document.getElementById('countryDialog').close(); return { lang: document.documentElement.lang, h1: document.querySelector('h1').textContent.trim(), btn: document.getElementById('donateLabel').textContent, counter: document.querySelector('.counter-line').textContent.replace(/\\s+/g,' ').trim() }`);
  R(en.lang === 'en' && en.h1 === 'Help keep Koivikko going.' && /^Give \$25 monthly$/.test(en.btn) && /people are pledging a combined A\$2,695/.test(en.counter), 'EN page unchanged', en);
  await e.close();

  // 3. Country popup + toasts + checkout flow in Finnish
  const f = await openPage(b, { fresh: true, initScript: FRESH + `; Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true, set(v) { v.toasts = { ...v.toasts, firstDelayMs: 300, minGapMs: 400, maxGapMs: 500 }; Object.defineProperty(window, 'KOIVIKKO_CONFIG', { value: v, writable: true }); } });` });
  await f.goto(B + '/?demo=1&lang=fi', 6000);
  const pop = await f.eval(`return { open: document.getElementById('countryDialog').open, title: document.getElementById('country-title').textContent, cur: document.getElementById('countryCur').textContent,
    names: [...document.getElementById('countrySelect').options].slice(0, 4).map(o => o.textContent), de: [...document.getElementById('countrySelect').options].find(o => o.value === 'DE').textContent,
    toast: document.querySelector('.toast') ? document.querySelector('.toast').textContent : '(none yet)' }`);
  R(pop.open && pop.title === 'Valitse maasi' && /^Lahjoitat valuutassa/.test(pop.cur) && pop.de === 'Saksa', 'FI country popup: title, currency line, country names', pop);
  R(!/Someone|pledged|gave|minutes ago/.test(pop.toast), 'FI live pop-up wording', pop.toast);
  await f.eval(`const s=document.getElementById('countrySelect'); s.value='AU'; s.dispatchEvent(new Event('change')); document.getElementById('countryContinue').click(); document.getElementById('coverFees').click(); document.getElementById('donateBtn').click(); return 1`);
  await sleep(2500);
  const co = await f.eval(`return { path: location.pathname, label: document.getElementById('label').textContent, head: document.getElementById('headline').textContent, pay: document.getElementById('pay').textContent }`);
  R(co.path === '/checkout-mock.html' && /Kuukausilahja/.test(co.label) && /AUD kuukaudessa/.test(co.head) && /Aloita kuukausilahja/.test(co.pay), 'FI checkout preview', co);
  await f.eval(`document.getElementById('pay').click(); return 1`);
  await sleep(2500);
  const ty = await f.eval(`return { h1: document.querySelector('h1').textContent, gift: document.getElementById('gift').textContent, wa: decodeURIComponent(document.getElementById('wa').href) }`);
  R(ty.h1 === 'Kiitos!' && /Kuukausilahjasi .*AUD/.test(ty.gift) && /Ryhdyin juuri tukemaan/.test(ty.wa), 'FI thank-you page + share text', ty);
  await f.close();

  // 4. Language remembered; ?lang=xx ignored; browser language detection
  const m = await openPage(b);
  await m.goto(B + '/?demo=1&lang=fi', 2000);
  await m.goto(B + '/?demo=1', 2500);
  R(await m.eval(`return document.documentElement.lang`) === 'fi', 'Choice remembered on next visit');
  await m.goto(B + '/?demo=1&lang=xx', 2500);
  R(await m.eval(`return document.documentElement.lang`) === 'fi', 'Unknown ?lang=xx ignored (keeps saved choice)');
  await m.goto(B + '/?demo=1&lang=%3Cscript%3E', 2500);
  R(await m.eval(`return !window.__xss && document.documentElement.lang === 'fi'`), 'Hostile ?lang= value ignored');
  await m.close();
  const nav = await openPage(b, { fresh: true, initScript: FRESH + `; Object.defineProperty(navigator, 'languages', { get: () => ['fi-FI', 'en'] });` });
  await nav.goto(B + '/?demo=1', 2500);
  R(await nav.eval(`return document.documentElement.lang`) === 'fi', 'Finnish browser → Finnish page automatically');
  await nav.close();

  // 5. Dropdown: keyboard, Esc, outside click, a11y, phones
  const k = await openPage(b);
  await k.goto(B + '/?demo=1&lang=en', 3000);
  await k.eval(`document.getElementById('countryDialog').close(); document.getElementById('langBtn').focus(); return 1`);
  const key = async (k2) => { await k.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: k2, code: k2, windowsVirtualKeyCode: { Enter: 13, Escape: 27, ArrowDown: 40, Tab: 9 }[k2] }); await k.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k2, code: k2 }); await sleep(150); };
  await key('Enter');
  const s1 = await k.eval(`return { open: !document.getElementById('langList').hidden, focus: document.activeElement.dataset.lang, expanded: document.getElementById('langBtn').getAttribute('aria-expanded') }`);
  await key('ArrowDown');
  const s2 = await k.eval(`return document.activeElement.dataset.lang`);
  await key('Escape');
  const s3 = await k.eval(`return { open: !document.getElementById('langList').hidden, focusBtn: document.activeElement.id }`);
  R(s1.open && s1.focus === 'en' && s1.expanded === 'true' && s2 === 'fi' && !s3.open && s3.focusBtn === 'langBtn', 'Dropdown keyboard: Enter opens, arrows move, Esc closes and returns focus', { s1, s2, s3 });
  await k.eval(`document.getElementById('langBtn').click(); document.querySelector('h1').click(); return 1`);
  R(await k.eval(`return document.getElementById('langList').hidden`), 'Dropdown closes on outside click');
  await k.cmd('Runtime.evaluate', { expression: AXE });
  const ax = await k.eval(`document.getElementById('langBtn').click(); const r = await axe.run(document.querySelector('.site-header'), { runOnly: ['wcag2a','wcag2aa','wcag21aa'] }); return r.violations.map(v => v.id + ':' + v.impact)`);
  R(Array.isArray(ax) && !ax.length, 'Dropdown passes axe (WCAG 2.1 AA)', ax);
  await k.close();
  for (const w of [320, 375, 768, 1366]) {
    const p = await openPage(b, { width: w, height: 760 });
    await p.goto(B + '/?demo=1&lang=fi', 3000);
    const r = await p.eval(`document.getElementById('countryDialog').close(); document.getElementById('langBtn').click(); const l = document.getElementById('langList').getBoundingClientRect(); const h = document.querySelector('.header-inner').getBoundingClientRect();
      return { hScroll: document.documentElement.scrollWidth > innerWidth, listInView: l.left >= 0 && l.right <= innerWidth, headerH: Math.round(h.height), btnH: Math.round(document.getElementById('langBtn').getBoundingClientRect().height) }`);
    R(!r.hScroll && r.listInView && r.headerH <= 70 && r.btnH >= 40, `${w}px: header fits, menu on screen, tap size`, r);
    await p.close();
  }
  // 6. Security: hostile country name in a Finnish pop-up stays text
  const x = await openPage(b, { initScript: `try { sessionStorage.setItem('k_demo','1') } catch (e) {}
    Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) { v.recent = async () => ({ items: [{ countryName: '<img src=x onerror="window.__xss=1">', amount: 5, currency: 'EUR', frequency: 'monthly', minutesAgo: 1 }] }); Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });
    Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true, set(v) { v.toasts = { ...v.toasts, firstDelayMs: 200 }; Object.defineProperty(window, 'KOIVIKKO_CONFIG', { value: v, writable: true }); } });` });
  await x.goto(B + '/?lang=fi', 2500);
  R(await x.eval(`return !window.__xss && !!document.querySelector('.toast')`), 'FI pop-up escapes hostile data (no XSS)');
  await x.close();
} finally { b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(0); }
