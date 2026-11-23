// Safe mode (site/safe-mode.js) and security.txt.
// Run:  node frontend-tests/server.js   then   node frontend-tests/safe-mode.test.mjs
import { launch, openPage, sleep } from './cdp.mjs';
const B = process.env.BASE || 'http://localhost:3001';
let fails = 0; const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, typeof d === 'string' ? d : JSON.stringify(d)); };
const STATE = `const n = document.getElementById('safeModeNote'); const btn = document.getElementById('donateBtn');
  return { note: n ? n.textContent : null, disabled: btn.disabled, refresh: !!document.getElementById('safeModeRefresh'),
    bank: n ? [...n.querySelectorAll('a')].some(a => a.getAttribute('href') === '#ways') : false, iban: (document.getElementById('iban') || {}).textContent, ready: window.KoivikkoAppReady === true }`;
const b = await launch();
try {
  // Normal start: no safe mode
  let p = await openPage(b);
  await p.goto(B + '/?lang=en', 2500);
  let r = await p.eval(STATE);
  R(r.ready && r.note === null && !r.disabled, 'Normal start: app ready, Donate enabled, no safe-mode message', r);
  await p.close();

  // A key file fails to load → giving paused with a clear message, refresh link and bank transfer link
  for (const file of ['app.js', 'config.js', 'api.js', 'country.js']) {
    p = await openPage(b);
    await p.cmd('Network.setBlockedURLs', { urls: [`*/${file}*`] });
    await p.goto(B + '/?lang=en', 2500);
    r = await p.eval(STATE);
    R(/paused/.test(r.note || '') && /Nothing was charged/.test(r.note) && r.disabled && r.refresh && r.bank && r.iban === 'FI11 5271 0420 4946 51',
      `${file} missing: Donate paused, "Nothing was charged", refresh + bank transfer links, IBAN still shown`, r);
    if (file === 'app.js') {
      const before = await p.eval(`return location.href`);
      await p.eval(`document.getElementById('donateForm').requestSubmit ? document.getElementById('donateForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })) : 0; return 1`);
      await sleep(800);
      R((await p.eval(`return location.href`)) === before, 'app.js missing: the form never does a plain submit (no silent page reload)');
    }
    await p.close();
  }

  // Finnish
  p = await openPage(b);
  await p.cmd('Network.setBlockedURLs', { urls: ['*/app.js*'] });
  await p.goto(B + '/?lang=fi', 2500);
  r = await p.eval(STATE);
  R(/tauolla/.test(r.note || '') && /Päivitä sivu/.test(r.note) && /tilisiirrolla/.test(r.note), 'Safe mode message in Finnish', r);
  await p.close();

  // security.txt
  const res = await fetch(B + '/.well-known/security.txt');
  const txt = await res.text();
  const exp = Date.parse((txt.match(/^Expires:\s*(\S+)/m) || [])[1] || '');
  R(res.status === 200 && /text\/plain/.test(res.headers.get('content-type') || '') && /^Contact:\s*mailto:\S+@\S+/m.test(txt) && exp > Date.now() + 30 * 864e5,
    'security.txt: served as text, has a contact, expiry is more than 30 days away (renew yearly)', { status: res.status, expires: new Date(exp).toISOString() });
} catch (e) { console.error('RUNNER ERROR', e); fails++; } finally { b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(0); }
