import { launch, openPage, sleep } from './cdp.mjs';
const B = process.env.BASE || 'http://localhost:3001';
let fails = 0; const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, typeof d === 'string' ? d : JSON.stringify(d)); };
const CLEAN = `if (!sessionStorage.getItem('__f')) { try { localStorage.clear(); localStorage.setItem('k_country','FI') } catch (e) {} sessionStorage.setItem('__f','1') }`;
const DEMO = `try { sessionStorage.setItem('k_demo','1') } catch (e) {}`;
const WITH_ID = `Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true, set(v) { v.analytics = { googleTagId: 'G-TEST1234', adsId: 'AW-99999999', adsConversion: 'AW-99999999/TestLabel', previewBannerInDemo: true };
  Object.defineProperty(window, 'KOIVIKKO_CONFIG', { value: v, writable: true }); } }); window.__csp = []; addEventListener('securitypolicyviolation', e => __csp.push(e.violatedDirective + ' ' + e.blockedURI));`;
const googleReqs = (p) => p.log.responses.concat(p.log.failed.map((f) => ({ url: f }))).filter((r) => /googletagmanager|google-analytics|doubleclick/.test(r.url));
const b = await launch();
try {
  // 1. off by default (no tag id, not demo): no banner, nothing from Google
  let p = await openPage(b, { fresh: true, real: true, initScript: CLEAN }); // a real visitor, not demo mode
  await p.goto(B + '/?lang=en', 3000);
  let r = await p.eval(`return { banner: !!document.querySelector('.consent'), settings: document.querySelector('[data-consent-settings]').hidden }`);
  R(!r.banner && r.settings && !googleReqs(p).length, 'Off by default: no banner, no "Cookie settings", no Google requests', r);
  await p.close();

  // 2. demo preview: banner in EN and FI, equal buttons, choices stored, still nothing from Google
  for (const lang of ['en', 'fi']) {
    p = await openPage(b, { fresh: true, initScript: CLEAN + DEMO });
    await p.goto(B + '/?lang=' + lang, 3000);
    r = await p.eval(`const c = document.querySelector('.consent'); const [no, yes] = c.querySelectorAll('button');
      return { text: c.querySelector('p').textContent, no: no.textContent, yes: yes.textContent, sameSize: Math.abs(no.offsetWidth - yes.offsetWidth) < 4 && no.offsetHeight === yes.offsetHeight,
        privacy: c.querySelector('a').getAttribute('href') }`);
    const words = lang === 'en' ? ['Decline', 'Accept', /cookies/] : ['Hylkää', 'Hyväksy', /evästeitä/];
    R(r.no === words[0] && r.yes === words[1] && words[2].test(r.text) && r.sameSize && /privacy-policy/.test(r.privacy), `Demo preview banner (${lang}): equal Accept/Decline + privacy link`, r);
    await p.close();
  }
  p = await openPage(b, { fresh: true, initScript: CLEAN + DEMO });
  await p.goto(B + '/?lang=en', 3000);
  r = await p.eval(`document.querySelector('.consent button').click(); return { hidden: document.querySelector('.consent').hidden, saved: JSON.parse(localStorage.getItem('k_consent')).choice }`);
  await p.goto(B + '/?lang=en', 2500);
  const again = await p.eval(`return !!document.querySelector('.consent') && !document.querySelector('.consent').hidden`);
  R(r.hidden && r.saved === 'denied' && !again && !googleReqs(p).length, 'Decline: banner closes, choice remembered, not asked again, nothing from Google', { ...r, again });
  r = await p.eval(`const s = document.querySelector('[data-consent-settings]'); const vis = !s.hidden; s.click(); return { vis, reopened: !document.querySelector('.consent').hidden }`);
  R(r.vis && r.reopened, '"Cookie settings" in the footer reopens the choice', r);
  await p.close();

  // 3. with a tag id (a real visitor, NOT demo: demo mode never loads Google, see security.test.mjs Fix 2):
  // Google loads ONLY after Accept; events forwarded with safe fields; no CSP violations
  p = await openPage(b, { fresh: true, real: true, initScript: CLEAN + WITH_ID });
  await p.cmd('Network.setBlockedURLs', { urls: ['*googletagmanager.com*', '*google-analytics.com*', '*doubleclick.net*'] }); // never really contact Google in tests
  await p.goto(B + '/?lang=en&utm_source=fb_ad', 3000);
  const before = googleReqs(p).length;
  r = await p.eval(`document.querySelectorAll('.amt')[2].click(); document.querySelector('[data-track="donate_click"]').click();
    const yes = document.querySelectorAll('.consent button')[1]; yes.click(); await new Promise(r => setTimeout(r, 800));
    window.dataLayer.push({ event: 'test_event', amount: 25, currency: 'AUD', email: 'someone@example.com', name: 'Jo' });
    const tagScript = [...document.scripts].find(s => /googletagmanager\\.com\\/gtag\\/js/.test(s.src));
    const evs = (window.kgDataLayer || []).map(a => Array.from(a)).filter(a => a[0] === 'event');
    return { tag: tagScript && tagScript.src, events: evs.map(e => e[1]), test: evs.find(e => e[1] === 'test_event'), consentDefault: (window.kgDataLayer || []).map(a => Array.from(a)).find(a => a[0] === 'consent'), csp: window.__csp }`);
  R(before === 0 && /id=G-TEST1234&l=kgDataLayer/.test(r.tag || ''), 'With a tag id: Google script requested only after Accept, on its own data channel', { before, tag: r.tag });
  R(r.events.includes('donate_click') && r.events.includes('consent_granted') && r.test && !('email' in r.test[2]) && !('name' in r.test[2]) && r.test[2].value === 25 && r.test[2].utm_source === undefined,
    'Events forwarded (incl. ones from before Accept), names/emails never sent', r.test);
  R(!r.csp.length, 'No security-policy violations with Google switched on', r.csp);
  await p.close();
  // donation conversion on the thank-you page
  p = await openPage(b, { real: true, initScript: WITH_ID + `try { localStorage.setItem('k_consent', JSON.stringify({ choice: 'granted', at: Date.now() })) } catch (e) {}
    Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) { v.session = async () => ({ amount: 40, currency: 'AUD', frequency: 'monthly', paid: true }); Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });` });
  await p.cmd('Network.setBlockedURLs', { urls: ['*googletagmanager.com*', '*google-analytics.com*', '*doubleclick.net*'] });
  await p.goto(B + '/thank-you.html?session_id=x&lang=en', 3000);
  r = await p.eval(`const evs = (window.kgDataLayer || []).map(a => Array.from(a)).filter(a => a[0] === 'event'); return { banner: !!document.querySelector('.consent:not([hidden])'), success: evs.find(e => e[1] === 'donation_success'), conv: evs.find(e => e[1] === 'conversion') }`);
  R(!r.banner && r.success && r.conv && r.conv[2].send_to === 'AW-99999999/TestLabel' && r.conv[2].value === 40 && r.conv[2].currency === 'AUD', 'Thank-you page: donation_success + Google Ads conversion with value and currency', r);
  await p.close();

  // 4. layout: phones, banner keeps pop-ups and the sticky bar clear
  for (const w of [320, 390, 1366]) {
    p = await openPage(b, { fresh: true, initScript: CLEAN + DEMO, width: w, height: 760 });
    await p.goto(B + '/?lang=fi', 3000);
    r = await p.eval(`const c = document.querySelector('.consent').getBoundingClientRect(); window.scrollTo(0, 1600); await new Promise(r => setTimeout(r, 400));
      return { fits: c.left >= 0 && c.right <= innerWidth + 1, hScroll: document.documentElement.scrollWidth > innerWidth, open: document.documentElement.classList.contains('consent-open'),
        stickyHidden: getComputedStyle(document.getElementById('stickyCta')).display === 'none' || getComputedStyle(document.getElementById('stickyCta')).transform !== 'none' && getComputedStyle(document.getElementById('stickyCta')).transform !== 'matrix(1, 0, 0, 1, 0, 0)',
        toastsAbove: parseFloat(getComputedStyle(document.getElementById('toasts')).bottom) >= c.height }`);
    R(r.fits && !r.hScroll && r.open && r.stickyHidden && r.toastsAbove, `${w}px: banner fits, sticky bar and pop-ups kept clear`, r);
    await p.close();
  }
} finally { b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(0); }
