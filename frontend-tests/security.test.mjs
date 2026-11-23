// Attack checks (from the 20 Nov 2026 update, adapted): every loophole found in the adversarial pass, now expected to be CLOSED.
// Run:  node frontend-tests/server.js   then   node frontend-tests/security.test.mjs
import { launch, openPage, sleep } from './cdp.mjs';
import http from 'node:http';
const B = process.env.BASE || 'http://localhost:3001';
const PORT = Number(new URL(B).port) || 80;
// Resolves to this computer but is NOT "localhost": the page treats it like a real web address
const REAL_LIKE = `http://give.koivikko.localhost:${PORT}`;
let fails = 0; const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, typeof d === 'string' ? d : JSON.stringify(d)); };
const BLOCK = ['*googletagmanager.com*', '*google-analytics.com*', '*doubleclick.net*', '*workers.dev*', '*stripe.com*', '*evil.example*'];
const b = await launch();
try {
  // 1 + 3: ?demo=1 ignored on a real address, and an old demo flag is cleared
  let p = await openPage(b, { real: true, initScript: `try { sessionStorage.setItem('k_demo', '1'); localStorage.setItem('k_country','AU'); localStorage.setItem('k_consent', JSON.stringify({choice:'granted', at: Date.now()})) } catch (e) {}` });
  await p.cmd('Network.setBlockedURLs', { urls: BLOCK });
  await p.goto(REAL_LIKE + '/?demo=1&lang=en', 3000);
  let r = await p.eval(`return { isMock: KoivikkoApi.isMock, flag: sessionStorage.getItem('k_demo'), counterShows56: /56 people/.test(document.querySelector('.counter-line').textContent) }`);
  R(!r.isMock && r.flag === null && !r.counterShows56, 'Fix 1+3: ?demo=1 on a real address is ignored; old demo flag cleared; no fake numbers', r);
  await p.goto(REAL_LIKE + '/checkout-mock.html?session_id=cs_test_mock_x', 2500);
  r = await p.eval(`return { expired: !document.getElementById('err').hidden, formHidden: document.getElementById('payForm').hidden }`);
  R(r.expired && r.formHidden, 'Fix 1: the demo checkout page cannot fake a payment on a real address', r);
  await p.close();
  // still works on this computer
  p = await openPage(b, { real: true });
  await p.goto(B + '/?demo=1&lang=en', 3000);
  R(await p.eval(`return KoivikkoApi.isMock && /56 people/.test(document.querySelector('.counter-line').textContent)`), 'Fix 1: ?demo=1 still works on localhost for reviews');
  await p.close();

  // 2: no Google, no conversion in demo mode even with a tag id and consent
  p = await openPage(b, { initScript: `try { localStorage.setItem('k_consent', JSON.stringify({choice:'granted', at: Date.now()})) } catch (e) {}
    Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true, set(v) { v.analytics = { googleTagId: 'G-TEST1234', adsConversion: 'AW-1/abc' }; Object.defineProperty(window, 'KOIVIKKO_CONFIG', { value: v, writable: true }); } });` });
  await p.cmd('Network.setBlockedURLs', { urls: BLOCK });
  await p.goto(B + '/?lang=en', 2500);
  await p.eval(`document.getElementById('donateBtn').click(); return 1`); await sleep(2500);
  await p.eval(`document.getElementById('pay') && document.getElementById('pay').click(); return 1`); await sleep(2500);
  r = await p.eval(`return { page: location.pathname, gtag: !![...document.scripts].find(s => /googletagmanager/.test(s.src)), events: (window.kgDataLayer || []).length }`);
  R(r.page.includes('thank-you') && !r.gtag && r.events === 0, 'Fix 2: demo gifts never load Google or send a conversion', r);
  await p.close();

  // 4 (changed on purpose): config.js is the ONE place for the bank details. No second "pinned"
  // copy in app.js: anything able to change config.js can change app.js too, and two copies
  // could drift apart when the foundation changes account. So the page must simply show and
  // copy exactly what config.js says, and never show a tamper warning (false alarms scared donors).
  p = await openPage(b, { initScript: `window.__copied = null; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } } }); } catch (e) {}
    Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true, set(v) { v.bank = { recipient: 'New Account Holder', iban: 'FI00 1234 5600 0007 85' }; Object.defineProperty(window, 'KOIVIKKO_CONFIG', { value: v, writable: true }); } });` });
  await p.goto(B + '/?lang=en', 3000);
  r = await p.eval(`document.getElementById('copyIban').click(); await new Promise(r => setTimeout(r, 300));
    return { shown: document.getElementById('iban').textContent, name: document.getElementById('bankRecipient').textContent, copied: window.__copied, notice: !!document.querySelector('.guard-note') }`);
  R(r.shown === 'FI00 1234 5600 0007 85' && r.name === 'New Account Holder' && r.copied === 'FI0012345600000785' && !r.notice, 'Fix 4 (one source): the page shows and copies exactly the bank details in config.js, no warning', r);
  await p.close();
  p = await openPage(b);
  await p.goto(B + '/?lang=en', 3000);
  r = await p.eval(`return { shown: document.getElementById('iban').textContent, notice: !!document.querySelector('.guard-note')}`);
  R(r.shown === 'FI11 5271 0420 4946 51' && !r.notice, 'Fix 4: normal config shows the real IBAN, no false alarm', r);
  await p.close();

  // 5: campaign tags cleaned and capped
  p = await openPage(b);
  await p.goto(B + `/?lang=en&utm_source=${'A'.repeat(5000)}&utm_campaign=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&utm_content=${encodeURIComponent('a\nb\u0000c"\'`')}&utm_medium=email%20newsletter`, 3000);
  r = await p.eval(`window.__sent = null; KoivikkoApi.checkout = async (x) => { __sent = x; throw new Error('stop'); }; document.getElementById('donateBtn').click(); await new Promise(r => setTimeout(r, 200)); return __sent && __sent.utm`);
  R(r && r.utm_source.length === 100 && !/[<>"'`\n\u0000]/.test(Object.values(r).join(' ')) && r.utm_medium === 'email newsletter', 'Fix 5: campaign tags capped at 100 characters, odd characters removed, normal tags kept', r);
  await p.close();
  p = await openPage(b, { initScript: `try { sessionStorage.setItem('k_utm', JSON.stringify({ utm_source: '<b>' + 'x'.repeat(400), evil: 'y' })) } catch (e) {}` });
  await p.goto(B + '/?lang=en', 2500);
  r = await p.eval(`window.__sent = null; KoivikkoApi.checkout = async (x) => { __sent = x; throw new Error('stop'); }; document.getElementById('donateBtn').click(); await new Promise(r => setTimeout(r, 200)); return __sent && __sent.utm`);
  R(r && !('evil' in r) && r.utm_source.length <= 100 && !/[<>]/.test(r.utm_source), 'Fix 5: tampered saved tags are cleaned too (unknown keys dropped)', r);
  await p.close();

  // 6: no debug logging on a real address (still on locally)
  p = await openPage(b, { real: true, initScript: `window.__infos = 0; const _i = console.info.bind(console); console.info = (...a) => { window.__infos++; _i(...a); }; try { localStorage.setItem('k_country','AU'); localStorage.setItem('k_consent', JSON.stringify({choice:'denied', at: Date.now()})) } catch (e) {}` });
  await p.cmd('Network.setBlockedURLs', { urls: BLOCK });
  await p.goto(REAL_LIKE + '/?lang=en', 2500);
  r = await p.eval(`document.querySelectorAll('.amt')[2].click(); document.querySelector('[data-track="donate_click"]').click(); return window.__infos`);
  R(r === 0, 'Fix 6: no debug output in the console on a real address', { infoLines: r });
  await p.close();

  // 7: strict checkout address
  const d3 = {};
  for (const u of ['https://checkout.stripe.com:8443/pay', 'https://user:pw@checkout.stripe.com/pay', 'https://checkout.stripe.com@evil.example/', 'https://evil.example/#checkout.stripe.com',
    'javascript://checkout.stripe.com/%0awindow.__xss=1', '//checkout.stripe.com.evil.example', 'http://checkout.stripe.com/pay', 'https://checkout.stripe.com.evil.example/pay']) {
    const q = await openPage(b, { initScript: `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) { v.checkout = async () => ({ url: ${JSON.stringify(u)} }); Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });` });
    await q.cmd('Network.setBlockedURLs', { urls: BLOCK });
    await q.goto(B + '/?lang=en', 2500);
    await q.eval(`document.getElementById('donateBtn').click(); return 1`); await sleep(1000);
    const href = await q.eval(`return location.href + (window.__xss ? ' XSS' : '')`);
    d3[u] = /localhost:\d+\/\?lang=en$/.test(href || '') ? 'blocked' : 'went to ' + href;
    await q.close();
  }
  R(Object.values(d3).every((v) => v === 'blocked'), 'Fix 7: odd ports, user:password@, look-alikes, javascript:, plain http all blocked', d3);
  const good = await openPage(b, { initScript: `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) { v.checkout = async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_ok' }); Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });` });
  await good.cmd('Network.setBlockedURLs', { urls: ['*stripe.com*'] });
  await good.goto(B + '/?lang=en', 2500);
  await good.eval(`document.getElementById('donateBtn').click(); return 1`); await sleep(1500);
  const gl = (await good.log.failed.concat(good.log.responses.map((x) => x.url))).join(' ');
  R(/checkout\.stripe\.com\/c\/pay\/cs_test_ok/.test(gl), 'Fix 7: the real Stripe Checkout address still works');
  await good.close();

  // still closed: injection through every URL parameter and poisoned storage
  const evil = encodeURIComponent('"><img src=x onerror=window.__xss=1><svg onload=window.__xss=1>');
  const hits = [];
  for (const path of [`/?lang=${evil}`, `/?country=${evil}`, `/?demo=${evil}`, `/?gclid=${evil}`, `/?utm_source=${evil}`, `/thank-you.html?session_id=${evil}`, `/checkout-mock.html?session_id=${evil}`, `/oci.html?${evil}`, `/#${evil}`]) {
    p = await openPage(b); await p.goto(B + path, 1800);
    if (await p.eval(`return !!window.__xss || document.querySelectorAll('img[src="x"], svg[onload]').length > 0`)) hits.push(path);
    await p.close();
  }
  R(!hits.length, 'Script injection through 9 URL entry points: none runs', hits);

  // 8: preview server
  const raw = (path, method = 'GET') => new Promise((res) => {
    const q = http.request({ host: '127.0.0.1', port: PORT, path, method }, (s) => { s.resume(); s.on('end', () => res({ s: s.statusCode, h: s.headers })); });
    q.on('error', (e) => res({ s: 'ERR', h: {} })); q.end(); });
  const files = {};
  for (const path of ['/index.html::$DATA', '/config.js::$DATA', '/config.js.', '/config.js%20', '/app.js%3A%3A%24DATA']) files[path] = (await raw(path)).s;
  R(Object.values(files).every((s) => s === 400 || s === 404), 'Fix 8: Windows stream names and trailing dot/space are refused', files);
  const hdr = {};
  for (const [path, m] of [['/', 'GET'], ['/nope.html', 'GET'], ['/..%2fserver.js', 'GET'], ['/%E0%A4%A', 'GET'], ['/', 'PUT']]) { const x = await raw(path, m); hdr[`${m} ${path} (${x.s})`] = x.h['x-frame-options'] === 'DENY' && x.h['x-content-type-options'] === 'nosniff'; }
  R(Object.values(hdr).every(Boolean), 'Fix 8: security headers on every response (200, 404, 403, 400, 405)', hdr);
} catch (e) { console.error('RUNNER ERROR', e); fails++; } finally { b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(0); }
