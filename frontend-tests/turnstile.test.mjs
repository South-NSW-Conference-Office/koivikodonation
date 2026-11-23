// Human check (Cloudflare Turnstile) and the country popup.
// Default (spamCheckOnCountry: false): the popup shows no check and loads no Turnstile script.
// The old "check in the popup" path is still tested by switching it on for the test.
import { launch, openPage } from './cdp.mjs';
const URL = (process.env.BASE || 'http://localhost:3001') + '/?demo=1';
const FRESH = `if (!sessionStorage.getItem('__f')) { try { localStorage.removeItem('k_country') } catch (e) {} sessionStorage.setItem('__f','1') }`;
// Turns spamCheckOnCountry on as config.js sets the settings (before app.js reads them)
const FORCE_ON = `(() => { let v; Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true,
  get: () => v, set: (x) => { v = x; if (x) x.spamCheckOnCountry = true; } }); })();`;
const b = await launch(); let fails = 0;
const report = (ok, name, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, JSON.stringify(d)); };
const state = `const box=document.getElementById('countrySpamCheck'); return { open: document.getElementById('countryDialog').open, boxShown: !box.hidden,
  hint: !document.getElementById('countrySpamHint').hidden, continueEnabled: !document.getElementById('countryContinue').disabled,
  hScroll: document.documentElement.scrollWidth > innerWidth }`;
const exceptions = [];
try {
  // 1. default: no check in the popup, Continue ready at once, no Turnstile request
  for (const w of [320, 375, 1366]) {
    const p = await openPage(b, { fresh: true, initScript: FRESH, width: w, height: 760 });
    await p.goto(URL, 3500);
    const r = await p.eval(state);
    const turnstile = p.log.responses.filter((x) => /challenges\.cloudflare\.com/.test(x.url)).length;
    report(r.open && !r.boxShown && !r.hint && r.continueEnabled && !r.hScroll && turnstile === 0, `${w}px default: popup has no check, Continue ready, Turnstile not loaded`, { ...r, turnstile });
    exceptions.push(...p.log.exceptions); await p.close();
  }
  // 2. switched on: widget fits small phones and Continue unlocks after the (test-key) check
  for (const w of [320, 414]) {
    const p = await openPage(b, { fresh: true, initScript: FRESH + FORCE_ON, width: w, height: 760 });
    await p.goto(URL, 6000);
    const r = await p.eval(`const box=document.getElementById('countrySpamCheck').getBoundingClientRect(); const dl=document.getElementById('countryDialog').getBoundingClientRect();
      return { open: document.getElementById('countryDialog').open, fitsDialog: box.right <= dl.right + 1 && box.left >= dl.left - 1, boxH: Math.round(box.height),
        hScroll: document.documentElement.scrollWidth > innerWidth, continueEnabled: !document.getElementById('countryContinue').disabled }`);
    report(r.open && r.fitsDialog && !r.hScroll && r.continueEnabled && r.boxH > 0, `${w}px switched on: widget fits, Continue unlocks after check`, r);
    exceptions.push(...p.log.exceptions); await p.close();
  }
  // 3. switched on but Turnstile blocked (ad blocker): Continue must still unlock
  const p = await openPage(b, { fresh: true, initScript: FRESH + FORCE_ON });
  await p.cmd('Network.setBlockedURLs', { urls: ['*challenges.cloudflare.com*'] });
  await p.goto(URL, 4000);
  const r = await p.eval(state);
  report(r.open && r.continueEnabled && !r.hint, 'Switched on, Turnstile blocked: Continue still unlocks, no stuck hint', r);
  exceptions.push(...p.log.exceptions); await p.close();
  report(!exceptions.length, 'No JS errors', exceptions);
} finally { b.close(); console.log(fails ? `${fails} failed` : 'all passed'); process.exit(0); }
