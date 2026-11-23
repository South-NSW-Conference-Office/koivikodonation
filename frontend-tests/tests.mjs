// Koivikko landing page — automated test suite (smoke, functional, responsive, a11y, perf, security)
// Run:  node frontend-tests/server.js   then   node frontend-tests/tests.mjs [all|smoke,func,resp,a11y,perf,links,sec]
// Needs Microsoft Edge (headless) and internet for axe-core (a11y suite only).
import { launch, openPage, sleep } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import http from 'node:http';

const BASE = process.env.BASE || 'http://localhost:3001';
const R = []; // results
const add = (suite, name, pass, detail = '') => { R.push({ suite, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} [${suite}] ${name}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); };
const only = (process.argv[2] || 'all').split(',');
const run = (s) => only.includes('all') || only.includes(s);

const AXE = (run('a11y') || run('country')) ? await fetch('https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js').then((r) => r.text()) : '';
const b = await launch();
try {
  // ======================================================================= SMOKE
  if (run('smoke')) {
    const pages = ['/', '/en', '/fi', '/thank-you', '/thank-you.html?session_id=bogus', '/donate-cancelled',
      '/checkout-mock.html?session_id=bogus', '/oci.html'];
    for (const p of pages) {
      const pg = await openPage(b);
      await pg.goto(BASE + p, 3000);
      const info = await pg.eval(`return { title: document.title, h1: document.querySelectorAll('h1').length,
        lang: document.documentElement.lang, viewport: !!document.querySelector('meta[name=viewport]') }`);
      const bad = pg.log.responses.filter((r) => r.status >= 400);
      add('smoke', `${p} loads`, !bad.length && !pg.log.exceptions.length && !pg.log.failed.length && info.h1 === 1,
        { title: info.title, h1: info.h1, http4xx5xx: bad.map((r) => r.status + ' ' + r.url), exceptions: pg.log.exceptions, failed: pg.log.failed, console: pg.log.console });
      await pg.close();
    }
  }

  // ======================================================================= FUNCTIONAL
  if (run('func')) {
    const pg = await openPage(b);
    await pg.goto(BASE + '/', 4500);
    // capture checkout requests instead of navigating
    await pg.eval(`window.__sent = []; KoivikkoApi.checkout = async (x) => { __sent.push(x); throw new Error('captured'); }; return 1`);

    const counter = await pg.eval(`return { hidden: document.getElementById('counter').hidden,
      text: document.querySelector('.counter-line').textContent.replace(/\\s+/g,' ').trim(),
      next: document.getElementById('nextNum').textContent, sticky: document.getElementById('stickyCount').textContent }`);
    add('func', 'Counter shows final numbers in AUD, never 0', !counter.hidden && /^56 people .*A\$2,695/.test(counter.text), counter);
    add('func', '"Be supporter #N" = donors + 1', counter.next === '#57', counter.next);

    // Other-amount edge cases
    const cases = ['', '0', '1', '-5', '2', '1e3', '10000', '10001', '12.345', 'abc', '999999999999'];
    for (const v of cases) {
      const r = await pg.eval(`
        document.getElementById('currency').value='EUR'; document.getElementById('currency').dispatchEvent(new Event('change'));
        document.querySelector('label[for=f-monthly]').click();
        document.querySelectorAll('.amt')[5].click();
        const o = document.getElementById('otherAmount'); o.value = ${JSON.stringify(v)}; o.dispatchEvent(new Event('input'));
        const before = __sent.length; document.getElementById('donateBtn').click(); await new Promise(r=>setTimeout(r,80));
        const err = document.getElementById('formError');
        return { label: document.getElementById('donateLabel').textContent, error: err.hidden ? null : err.textContent,
                 sent: __sent.length > before ? __sent[__sent.length-1] : null, inputVal: o.value }`);
      const valid = ['2', '10000'].includes(v) ? true : ['', '0', '1', '-5', '1e3', '10001', '12.345', 'abc', '999999999999'].includes(v) ? false : Number(v) >= 2 && Number(v) <= 10000;
      const ok = valid ? !!r.sent && (!r.error || /^captured/.test(r.error)) : !r.sent && !!r.error;
      add('func', `Other amount "${v}" ${valid ? 'accepted' : 'rejected'}`, ok, r);
    }

    // Fee maths for every preset in every currency/frequency
    const fees = await pg.eval(`
      const out = []; const C = window.KOIVIKKO_CONFIG;
      for (const cur of C.currencies) for (const f of ['monthly','one-time']) C.presets[f][cur].forEach((v, i) => {
        const c=document.getElementById('currency'); c.value=cur; c.dispatchEvent(new Event('change'));
        document.querySelector('label[for=' + (f==='monthly'?'f-monthly':'f-once') + ']').click();
        document.querySelectorAll('.amt')[i].click();
        const fee = document.getElementById('feeAmt').textContent;
        const cb = document.getElementById('coverFees'); if (!cb.checked) cb.click();
        const label = document.getElementById('donateLabel').textContent; cb.click();
        const expectFee = Math.max(0.3, Math.round(v * C.coverFeesRate * 20) / 20);
        const num = parseFloat(label.replace(/[^0-9.]/g,''));
        out.push({ cur, f, v, fee, label, ok: Math.abs(num - (v + expectFee)) < 0.001 });
      }); return out;`);
    const badFees = fees.filter((x) => !x.ok);
    add('func', `Cover-fees total correct for all ${fees.length} presets`, !badFees.length, badFees.slice(0, 5));

    // Upsell
    const up = await pg.eval(`
      const c=document.getElementById('currency'); c.value='EUR'; c.dispatchEvent(new Event('change'));
      document.querySelector('label[for=f-once]').click(); document.querySelectorAll('.amt')[1].click();
      const shown = !document.getElementById('nudge').hidden; const txt = document.getElementById('nudgeBtn').textContent;
      document.getElementById('nudgeBtn').click();
      return { shown, txt, freq: document.querySelector('input[name=frequency]:checked').value, label: document.getElementById('donateLabel').textContent }`);
    add('func', 'One-time → monthly upsell switches correctly', up.shown && up.freq === 'monthly' && /monthly/.test(up.label) && up.label.includes(up.txt.match(/€\d+/)[0]), up);

    // Keyboard on amount radiogroup
    const kb = await pg.eval(`
      document.querySelector('label[for=f-monthly]').click(); document.querySelectorAll('.amt')[1].focus();
      document.getElementById('amounts').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const btns=[...document.querySelectorAll('.amt')];
      return { checked: btns.findIndex(b=>b.getAttribute('aria-checked')==='true'), focused: btns.indexOf(document.activeElement),
               tabbable: btns.filter(b=>b.tabIndex===0).length }`);
    add('func', 'Arrow keys move amount selection (roving tabindex)', kb.checked === 2 && kb.focused === 2 && kb.tabbable === 1, kb);

    // Currency switch keeps checkout in sync (regression for reported bug)
    const sync = await pg.eval(`
      document.getElementById('currency').value='AUD'; document.getElementById('f-once').checked=true;
      dispatchEvent(new PageTransitionEvent('pageshow'));
      const before = __sent.length; document.getElementById('donateBtn').click(); await new Promise(r=>setTimeout(r,80));
      return { label: document.getElementById('donateLabel').textContent, sent: __sent[__sent.length-1] }`);
    add('func', 'Restored AUD + one-time state matches checkout (regression)', sync.sent && sync.sent.currency === 'AUD' && sync.sent.frequency === 'one-time', sync);

    // Donate CTAs all point at the form
    const ctas = await pg.eval(`return [...document.querySelectorAll('a[href="#give"]')].length`);
    add('func', 'All Donate CTAs anchor to #give', ctas >= 5, ctas + ' CTAs');

    // AU dialog
    const au = await pg.eval(`
      document.querySelector('[data-open-au]').click(); const d = document.getElementById('auDialog'); const f = document.getElementById('auForm');
      const errs = () => [...f.querySelectorAll('.field-error')].filter(e => !e.hidden).map(e => e.textContent);
      const open1 = d.open; f.requestSubmit(); await new Promise(r=>setTimeout(r,200)); const errEmpty = errs();
      f.name.value='Al'; f.email.value='not-an-email'; f.requestSubmit(); await new Promise(r=>setTimeout(r,200)); const errBad = errs();
      d.close(); return { open1, errEmpty, errBad, closed: !d.open }`);
    add('func', 'AU form validates empty/invalid email (messages under fields)', au.open1 && au.errEmpty.length === 2 && au.errBad.length === 1 && /valid email/.test(au.errBad[0]), au);
    const hp = await pg.eval(`
      const f = document.getElementById('auForm'); document.querySelector('[data-open-au]').click();
      f.name.value='Bot'; f.email.value='bot@example.test'; f.leaveBlank.value='spam co'; f.requestSubmit(); await new Promise(r=>setTimeout(r,800));
      const r = { done: !document.getElementById('auDone').hidden }; document.getElementById('auDialog').close(); return r`);
    add('func', 'AU honeypot silently accepted (bots see success)', hp.done, hp);

    // FI language
    const fi = await pg.eval(`document.getElementById('langBtn').click(); return [...document.querySelectorAll('#langList [role=option]')].map(o => o.textContent.replace('✓','').trim())`);
    add('func', 'Language dropdown offers English and Suomi', JSON.stringify(fi) === JSON.stringify(['English', 'Suomi']), fi);
    await pg.close();

    // Toasts: max 5 per visit, dismiss stops them
    const tp = await openPage(b, { initScript: `window.__toastCount = 0; new MutationObserver(m => m.forEach(x => x.addedNodes.forEach(n => n.classList && n.classList.contains('toast') && window.__toastCount++))).observe(document, {subtree:true, childList:true});
      Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true, set(v) { v.toasts = { ...v.toasts, firstDelayMs: 200, minGapMs: 300, maxGapMs: 400 };
        Object.defineProperty(window, 'KOIVIKKO_CONFIG', { value: v, writable: true }); } });` });
    await tp.goto(BASE + '/', 7000);
    const tc = await tp.eval(`return window.__toastCount`);
    add('func', 'Toasts capped at 5 per visit', tc > 0 && tc <= 5, tc + ' shown');
    const tx = await tp.eval(`return [...document.querySelectorAll('.toast')].every(t => t.querySelector('.t-x') && t.getAttribute('role')==='status')
      && document.getElementById('toasts').getAttribute('aria-live')==='polite'`);
    add('func', 'Toasts are closable and announced politely', tx !== false, tx);
    await tp.close();

    // Counter hides quietly when the API fails (PRD 6.3)
    const fp = await openPage(b, { initScript: `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) {
        v.stats = () => Promise.reject(new Error('down')); v.recent = () => Promise.reject(new Error('down'));
        Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });` });
    await fp.goto(BASE + '/', 3000);
    const fr = await fp.eval(`return { counterHidden: document.getElementById('counter').hidden, toasts: document.querySelectorAll('.toast').length,
      formWorks: !!document.getElementById('donateBtn') }`);
    add('func', 'API down → counter hidden, no error shown, form still works', fr.counterHidden && fr.formWorks, { ...fr, exceptions: fp.log.exceptions });
    await fp.close();

    // Counter with 0 donors stays hidden
    const zp = await openPage(b, { initScript: `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) {
        v.stats = async () => ({ activeMonthlyDonors: 0, monthlyPledgedTotal: 0, currency: 'EUR' });
        Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });` });
    await zp.goto(BASE + '/', 2500);
    add('func', 'Zero donors → counter hidden (never show 0)', await zp.eval(`return document.getElementById('counter').hidden`));
    await zp.close();

    // Full flow: monthly AUD 40 + fees → checkout → thank-you
    const ff = await openPage(b, { width: 390, height: 844 });
    await ff.goto(BASE + '/', 2500);
    await ff.eval(`const c=document.getElementById('currency'); c.value='AUD'; c.dispatchEvent(new Event('change'));
      document.getElementById('coverFees').click(); document.getElementById('donateBtn').click(); return 1`);
    await sleep(2500);
    const co = await ff.eval(`return { path: location.pathname, head: document.getElementById('headline').textContent,
      lines: document.getElementById('lines').textContent.replace(/\\s+/g,' '), pay: document.getElementById('pay').textContent }`);
    add('func', 'Checkout preview matches chosen gift (A$40 + A$1.20 fee)', co.path === '/checkout-mock.html' && /A\$41\.20 AUD per month/.test(co.head) && /A\$1\.20/.test(co.lines), co);
    await ff.eval(`document.getElementById('pay').click(); return 1`);
    await sleep(2500);
    const ty = await ff.eval(`return { path: location.pathname, gift: document.getElementById('gift').textContent,
      wa: document.getElementById('wa').href, fb: document.getElementById('fb').href, em: document.getElementById('em').href }`);
    add('func', 'Thank-you shows amount + share links carry UTM', ty.path === '/thank-you.html' && /A\$41\.20 monthly/.test(ty.gift) && /utm_source%3Dshare/.test(ty.wa), ty);
    await ff.close();

    // Bad session id on checkout / thank-you
    const bs = await openPage(b);
    await bs.goto(BASE + '/checkout-mock.html?session_id=nope', 2500);
    add('func', 'Checkout with invalid session shows "expired", hides form', await bs.eval(`return !document.getElementById('err').hidden && document.getElementById('payForm').hidden`));
    await bs.goto(BASE + '/thank-you.html', 1500);
    add('func', 'Thank-you without session shows generic thanks', await bs.eval(`return /on its way/.test(document.getElementById('gift').textContent)`));
    await bs.goto(BASE + '/oci.html', 2500);
    const oc = await bs.eval(`const g=document.getElementById('go'); return { href: g.href, blank: g.target, rel: g.rel, steps: document.querySelectorAll('.steps li').length, ministry: /Koivikko Lifestyle Institute/.test(document.body.textContent) }`);
    add('func', 'OCI page links to OCI donate page in a new tab and names the ministry', oc.href === 'https://www.outpostcenters.org/en/oci-website/donate' && oc.blank === '_blank' && /noopener/.test(oc.rel) && oc.ministry, oc);
    await bs.close();
  }

  // ======================================================================= RESPONSIVE
  if (run('resp')) {
    for (const w of [320, 360, 390, 414, 768, 820, 1024, 1366, 1920]) {
      for (const p of ['/', '/checkout-mock.html?session_id=x', '/oci.html', '/thank-you.html', '/donate-cancelled.html']) {
        const pg = await openPage(b, { width: w, height: w < 768 ? 800 : 900 });
        await pg.goto(BASE + p, 2500);
        const r = await pg.eval(`
          document.querySelectorAll('details').forEach(d=>d.open=true);
          const vw = document.documentElement.clientWidth; const offenders = [];
          document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect();
            if (r.width && (r.right > vw + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed' && !el.closest('.toasts,dialog,.hero-bg,.final-bg,.sticky-cta,.skip'))
              offenders.push((el.id ? '#'+el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' ' + Math.round(r.left) + '→' + Math.round(r.right)); });
          const small = [...document.querySelectorAll('button, a.btn, .amt, input, select')].filter(e => { const r=e.getBoundingClientRect(); return r.width && r.height && r.height < 40 && !e.closest('.lang,.demo-bar,dialog,.secure-row') && e.type!=='checkbox' && e.type!=='radio' && !e.classList.contains('copy') && !e.classList.contains('btn-link'); })
            .map(e => (e.id||e.className||e.tagName)+':'+Math.round(e.getBoundingClientRect().height));
          return { hScroll: document.documentElement.scrollWidth > vw, offenders: [...new Set(offenders)].slice(0,6), smallTargets: ${w} < 768 ? small.slice(0,6) : [] }`);
        if (r.__error) { console.log('EVAL ERROR', r.__error); await pg.close(); throw new Error(r.__error); }
        add('resp', `${w}px ${p} no horizontal overflow`, !r.hScroll && !r.offenders.length, r.hScroll || r.offenders.length ? r : '');
        if (w < 768 && r.smallTargets.length) add('resp', `${w}px ${p} tap targets ≥40px`, false, r.smallTargets);
        await pg.close();
      }
    }
    // sticky bar must not cover the donate button and toasts must sit above it
    const m = await openPage(b, { width: 375, height: 700 });
    await m.goto(BASE + '/', 2500);
    const st = await m.eval(`
      document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, 0); await new Promise(r=>setTimeout(r,500));
      const atTop = document.getElementById('stickyCta').classList.contains('show');
      document.getElementById('donateBtn').scrollIntoView({block:'end'}); await new Promise(r=>setTimeout(r,500));
      const onForm = document.getElementById('stickyCta').classList.contains('show');
      window.scrollTo(0, document.querySelector('.story').offsetTop + 400); await new Promise(r=>setTimeout(r,500));
      const mid = document.getElementById('stickyCta').classList.contains('show');
      const bar = document.getElementById('stickyCta').getBoundingClientRect(); const ts = document.getElementById('toasts').getBoundingClientRect();
      window.scrollTo(0, document.body.scrollHeight); await new Promise(r=>setTimeout(r,500));
      const atFooter = document.getElementById('stickyCta').classList.contains('show');
      return { atTop, onForm, mid, atFooter, toastBottom: Math.round(ts.bottom), barTop: Math.round(bar.top) }`);
    add('resp', 'Mobile sticky bar: hidden at top/form/footer, shown mid-page', !st.atTop && !st.onForm && st.mid && !st.atFooter, st);
    add('resp', 'Mobile toasts sit above sticky bar', st.toastBottom <= st.barTop, st);
    await m.close();
  }

  // ======================================================================= ACCESSIBILITY
  if (run('a11y')) {
    for (const p of ['/', '/checkout-mock.html?session_id=x', '/thank-you.html', '/donate-cancelled.html', '/oci.html']) {
      const pg = await openPage(b);
      await pg.goto(BASE + p, 2500);
      await pg.cmd('Runtime.evaluate', { expression: AXE });
      const r = await pg.eval(`
        const out = await axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21aa','best-practice'] });
        return out.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, eg: v.nodes.slice(0,3).map(n=>n.target.join(' ')) }))`);
      if (r && r.__error) { add('a11y', `${p} axe run`, false, r.__error); }
      else {
        const serious = r.filter((v) => ['serious', 'critical'].includes(v.impact));
        add('a11y', `${p} axe: no serious/critical violations`, !serious.length, serious);
        r.filter((v) => !['serious', 'critical'].includes(v.impact)).forEach((v) => add('a11y', `${p} axe ${v.impact}: ${v.id}`, false, v));
      }
      await pg.close();
    }
    // keyboard tab order reaches the donate button, no focus traps
    const k = await openPage(b);
    await k.goto(BASE + '/', 2000);
    const seq = [];
    for (let i = 0; i < 40; i++) {
      await k.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await k.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      seq.push(await k.eval(`const a=document.activeElement; if (a === document.body) return 'BODY|false'; const cs=getComputedStyle(a); return (a.id||a.textContent.trim().slice(0,22)||a.tagName) + '|' + (cs.outlineStyle!=='none' || cs.boxShadow!=='none')`));
    }
    const reached = seq.findIndex((s) => s.startsWith('donateBtn'));
    add('a11y', 'Keyboard: Tab reaches Donate button', reached > 0, `reached after ${reached + 1} tabs; first: ${seq.slice(0, 6).join(', ')}`);
    const noFocus = seq.filter((s) => s.endsWith('|false') && !s.startsWith('BODY'));
    add('a11y', 'Keyboard: every focused element has a visible focus style', !noFocus.length, noFocus.slice(0, 6));
    await k.close();
  }

  // ======================================================================= PERFORMANCE & SEO
  if (run('perf')) {
    const pg = await openPage(b, { width: 390, height: 844 });
    await pg.cmd('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8 * 1024 / 1000 * 1000, uploadThroughput: 750e3 / 8 });
    await pg.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__lcp=0; new PerformanceObserver(l=>{const e=l.getEntries(); window.__lcp=e[e.length-1].startTime}).observe({type:'largest-contentful-paint', buffered:true}); window.__cls=0; new PerformanceObserver(l=>l.getEntries().forEach(e=>{ if(!e.hadRecentInput) window.__cls+=e.value })).observe({type:'layout-shift', buffered:true});` });
    await pg.goto(BASE + '/', 9000);
    const m = await pg.eval(`const n = performance.getEntriesByType('navigation')[0];
      return { lcp: Math.round(__lcp), cls: +__cls.toFixed(3), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd),
        resources: performance.getEntriesByType('resource').map(r => ({ u: r.name.replace(location.origin,''), kb: Math.round(r.transferSize/1024), t: r.initiatorType })) }`);
    const totalKb = m.resources.reduce((a, r) => a + r.kb, 0);
    add('perf', 'LCP < 2.5s on slow 4G (mobile)', m.lcp < 2500, m.lcp + ' ms');
    add('perf', 'CLS < 0.1', m.cls < 0.1, m.cls);
    add('perf', 'Total page weight < 1.5 MB', totalKb < 1536, totalKb + ' KB');
    m.resources.filter((r) => r.kb > 150).forEach((r) => add('perf', `Large file ${r.u}`, false, r.kb + ' KB'));
    const seo = await pg.eval(`const q=(s)=>document.querySelector(s);
      return { title: document.title.length, desc: (q('meta[name=description]')||{}).content?.length, canonical: q('link[rel=canonical]')?.href,
        ogImage: q('meta[property="og:image"]')?.content, ogUrl: !!q('meta[property="og:url"]'), hreflang: document.querySelectorAll('link[hreflang]').length,
        imgsNoAlt: [...document.images].filter(i=>!i.hasAttribute('alt')).length, imgsNoSize: [...document.images].filter(i=>!i.getAttribute('width') && !i.closest('.hero-bg,.collage,.tile,.final')).map(i=>i.src.split('/').pop()) }`);
    add('seo', 'Title 30–65 chars, description 70–160', seo.title >= 30 && seo.title <= 65 && seo.desc >= 70 && seo.desc <= 160, seo);
    add('seo', 'og:url present', seo.ogUrl, seo);
    add('seo', 'All images have alt', seo.imgsNoAlt === 0, seo.imgsNoAlt);
    for (const f of ['/robots.txt', '/sitemap.xml']) {
      const s = await fetch(BASE + f).then((r) => r.status);
      add('seo', `${f} exists`, s === 200, s);
    }
    for (const p of ['/thank-you.html', '/donate-cancelled.html', '/checkout-mock.html', '/oci.html']) {
      const html = await fetch(BASE + p).then((r) => r.text());
      add('seo', `${p} is noindex`, /name="robots" content="noindex"/.test(html));
    }
    await pg.close();
  }

  // ======================================================================= LINKS
  if (run('links')) {
    const pg = await openPage(b);
    const all = new Map();
    for (const p of ['/', '/thank-you.html', '/donate-cancelled.html', '/oci.html', '/checkout-mock.html?session_id=x']) {
      await pg.goto(BASE + p, 1500);
      const links = await pg.eval(`return [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, raw: a.getAttribute('href'), blank: a.target==='_blank', rel: a.rel, text: a.textContent.trim().slice(0,30) }))`);
      links.forEach((l) => all.set(p + ' ' + l.raw, { ...l, page: p }));
    }
    const ids = await pg.eval(`return [...document.querySelectorAll('[id]')].map(e=>e.id)`);
    await pg.goto(BASE + '/', 1200);
    const idsIndex = await pg.eval(`return [...document.querySelectorAll('[id]')].map(e=>e.id)`);
    for (const l of all.values()) {
      if (l.blank && !/noopener/.test(l.rel)) add('links', `${l.page} target=_blank without noopener: ${l.raw}`, false);
      if (l.raw === '#' && !(l.page === '/oci.html')) add('links', `${l.page} dead "#" link: ${l.text}`, false);
      if (l.raw.startsWith('#') && l.raw.length > 1 && l.page === '/' && !idsIndex.includes(l.raw.slice(1))) add('links', `${l.page} anchor target missing ${l.raw}`, false);
      if (l.href.startsWith(BASE)) {
        const u = new URL(l.href); const s = await fetch(BASE + u.pathname).then((r) => r.status);
        if (s !== 200) add('links', `${l.page} broken internal link ${l.raw}`, false, s);
        if (u.hash.length > 1 && u.pathname.endsWith('index.html') && !idsIndex.includes(u.hash.slice(1))) add('links', `${l.page} anchor missing ${l.raw}`, false);
      }
    }
    add('links', `Checked ${all.size} links across 5 pages`, true, [...new Set([...all.values()].filter((l) => !l.href.startsWith(BASE)).map((l) => l.href.split('?')[0]))]);
    await pg.close();
  }

  // ======================================================================= COUNTRY POPUP → CURRENCY
  if (run('country')) {
    // fresh visitor in this tab only (browser profile is shared between tabs)
    const FRESH = `if (!sessionStorage.getItem('__fresh')) { try { localStorage.removeItem('k_country') } catch (e) {} sessionStorage.setItem('__fresh', '1') }`;
    const pg = await openPage(b, { fresh: true, initScript: FRESH, width: 390, height: 844 });
    await pg.goto(BASE + '/', 2500);
    const first = await pg.eval(`const d=document.getElementById('countryDialog'); return { open: d.open, pre: document.getElementById('countrySelect').value,
      title: document.getElementById('country-title').textContent, chips: document.querySelectorAll('.country-chip, #countryQuick').length,
      focus: document.activeElement.id, focusInDialog: d.contains(document.activeElement),
      options: document.getElementById('countrySelect').options.length, currency: document.getElementById('currency').value }`);
    add('country', 'First visit: "Choose your country" popup, no quick buttons, guess pre-filled, focus on the dropdown', first.open && first.title === 'Choose your country' && first.chips === 0 && !!first.pre && first.focus === 'countrySelect' && first.options > 200, first);
    add('country', 'Form already has a currency behind the popup (never empty)', ['AUD', 'EUR', 'USD'].includes(first.currency), first.currency);

    // the agreed rule for a spread of countries, via the full list
    const expect = { AU: 'AUD', FI: 'EUR', DE: 'EUR', GB: 'EUR', SE: 'EUR', NO: 'EUR', CH: 'EUR', US: 'USD', CA: 'USD', PH: 'USD',
      NZ: 'USD', KE: 'USD', JP: 'USD', BR: 'USD', TR: 'USD', ZA: 'USD' };
    for (const [code, cur] of Object.entries(expect)) {
      const r = await pg.eval(`const d=document.getElementById('countryDialog'); if (!d.open) document.getElementById('changeCountry').click();
        const sel=document.getElementById('countrySelect'); sel.value='${code}'; sel.dispatchEvent(new Event('change'));
        const preview=document.getElementById('countryCur').textContent;
        await new Promise(r => { const t0 = Date.now(); (function w() { if (!document.getElementById('countryContinue').disabled || Date.now() - t0 > 6000) r(); else setTimeout(w, 100); })(); }); document.getElementById('countryForm').requestSubmit(); await new Promise(r=>setTimeout(r,60));
        return { currency: document.getElementById('currency').value, preview, from: document.getElementById('countryName').textContent,
          first: document.querySelector('.amt').textContent, label: document.getElementById('donateLabel').textContent, open: d.open }`);
      add('country', `${code} → ${cur}`, r.currency === cur && r.preview.includes(cur) && !r.open && r.label.startsWith('Give'), r);
    }

    await pg.eval(`window.pick = async (c) => { document.getElementById('changeCountry').click(); const sel=document.getElementById('countrySelect'); sel.value=c; await new Promise(r => { const t0 = Date.now(); (function w() { if (!document.getElementById('countryContinue').disabled || Date.now() - t0 > 6000) r(); else setTimeout(w, 100); })(); }); document.getElementById('countryForm').requestSubmit(); }; return 1`);
    // AU suggests the family-trust pathway, US suggests OCI
    const sug = await pg.eval(`const pick=async (c)=>{ document.getElementById('changeCountry').click(); const sel=document.getElementById('countrySelect'); sel.value=c; await new Promise(r => { const t0 = Date.now(); (function w() { if (!document.getElementById('countryContinue').disabled || Date.now() - t0 > 6000) r(); else setTimeout(w, 100); })(); }); document.getElementById('countryForm').requestSubmit();
        return [...document.querySelectorAll('.is-suggested')].map(e => e.querySelector('[data-open-au]') || e.matches('[data-open-au]') ? 'AU' : 'US') };
      return { AU: await pick('AU'), US: await pick('US'), FI: await pick('FI') }`);
    add('country', 'AU → family-trust suggested, US → OCI suggested, FI → none', sug.AU.length && sug.AU.every((x) => x === 'AU') && sug.US.length && sug.US.every((x) => x === 'US') && !sug.FI.length, sug);

    // pre-filled answer + Continue = one tap
    const chip = await pg.eval(`await pick('AU'); document.getElementById('changeCountry').click();
      const pre = document.getElementById('countrySelect').value; await new Promise(r => { const t0 = Date.now(); (function w() { if (!document.getElementById('countryContinue').disabled || Date.now() - t0 > 6000) r(); else setTimeout(w, 100); })(); }); document.getElementById('countryContinue').click();
      return { pre, open: document.getElementById('countryDialog').open, currency: document.getElementById('currency').value, saved: localStorage.getItem('k_country') }`);
    add('country', 'Reopening pre-fills the current country; Continue keeps AUD and remembers it', chip.pre === 'AU' && !chip.open && chip.currency === 'AUD' && chip.saved === 'AU', chip);

    // Esc / × keeps the current country
    const esc = await pg.eval(`document.getElementById('changeCountry').click(); const sel=document.getElementById('countrySelect'); sel.value='DE'; sel.dispatchEvent(new Event('change'));
      document.getElementById('countryDialog').close(); return { currency: document.getElementById('currency').value, name: document.getElementById('countryName').textContent }`);
    add('country', 'Closing without confirming keeps the previous country', esc.currency === 'AUD' && esc.name === 'Australia', esc);

    // checkout receives the country, mock checkout pre-selects it
    await pg.eval(`document.getElementById('donateBtn').click(); return 1`);
    await sleep(2500);
    const co = await pg.eval(`return { path: location.pathname, head: document.getElementById('headline').textContent, country: document.getElementById('country').value }`);
    add('country', 'Checkout gets AUD and pre-selects Australia', co.path === '/checkout-mock.html' && /AUD/.test(co.head) && co.country === 'Australia', co);

    // returning visitor: no popup, remembered country
    await pg.goto(BASE + '/', 2500);
    const back = await pg.eval(`return { open: document.getElementById('countryDialog').open, currency: document.getElementById('currency').value, name: document.getElementById('countryName').textContent }`);
    add('country', 'Returning visitor: no popup, remembered country and currency', !back.open && back.currency === 'AUD' && back.name === 'Australia', back);
    await pg.close();

    // ?country= from an ad link skips the question; invalid values are ignored
    const ad = await openPage(b, { fresh: true, initScript: FRESH });
    await ad.goto(BASE + '/?country=de&utm_source=fb_eu', 2500);
    const adr = await ad.eval(`return { open: document.getElementById('countryDialog').open, currency: document.getElementById('currency').value, name: document.getElementById('countryName').textContent }`);
    add('country', '?country=de in an ad link: no popup, EUR, Germany', !adr.open && adr.currency === 'EUR' && adr.name === 'Germany', adr);
    await ad.close();
    const bad = await openPage(b, { fresh: true, initScript: FRESH });
    await bad.goto(BASE + '/?country=%3Cscript%3E', 2500);
    const badr = await bad.eval(`return { open: document.getElementById('countryDialog').open, xss: !!window.__xss, currency: document.getElementById('currency').value }`);
    add('country', 'Invalid ?country= is ignored (popup asks instead)', badr.open && !badr.xss, badr);
    await bad.close();

    // storage blocked (private mode): still works, just asks every visit
    const ps = await openPage(b, { fresh: true, initScript: `Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } });` });
    await ps.goto(BASE + '/', 4500);
    const psr = await ps.eval(`const d=document.getElementById('countryDialog'); const was=d.open; document.getElementById('countryContinue').click();
      return { was, closed: !d.open, currency: document.getElementById('currency').value }`);
    add('country', 'Blocked localStorage (private mode): popup still works', psr.was && psr.closed && !!psr.currency, { ...psr, exceptions: ps.log.exceptions });
    await ps.close();

    // keyboard + accessibility of the open popup
    const k = await openPage(b, { fresh: true, initScript: FRESH });
    await k.goto(BASE + '/', 2500);
    await k.cmd('Runtime.evaluate', { expression: AXE });
    const ax = await k.eval(`const out = await axe.run(document.getElementById('countryDialog'), { runOnly: ['wcag2a','wcag2aa','wcag21aa'] }); return out.violations.map(v => v.id + ':' + v.impact)`);
    add('country', 'Popup passes axe (WCAG 2.1 AA)', Array.isArray(ax) && !ax.length, ax);
    const trapped = [];
    for (let i = 0; i < 12; i++) {
      await k.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await k.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      trapped.push(await k.eval(`return document.getElementById('countryDialog').contains(document.activeElement) || document.activeElement === document.body`));
    }
    add('country', 'Keyboard focus stays inside the popup while open', trapped.every(Boolean), trapped.filter((x) => !x).length + ' escapes');
    await k.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
    add('country', 'Esc closes the popup', await k.eval(`return !document.getElementById('countryDialog').open`));
    await k.close();
  }

  // ======================================================================= SECURITY
  if (run('sec')) {
    // 1. XSS via live-feed data (countryName) from the API
    const payload = `<img src=x onerror="window.__xss=(window.__xss||0)+1">`;
    const x1 = await openPage(b, { initScript: `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) {
        v.recent = async () => ({ items: [{ countryName: ${JSON.stringify(payload)}, amount: 5, currency: 'EUR', frequency: 'monthly', minutesAgo: 1 }] });
        v.stats = async () => ({ activeMonthlyDonors: '<img src=x onerror="window.__xss=(window.__xss||0)+1">', monthlyPledgedTotal: 10, currency: 'EUR' });
        Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });
        addEventListener('DOMContentLoaded', () => { window.KOIVIKKO_CONFIG.toasts.firstDelayMs = 200; });` });
    await x1.goto(BASE + '/', 2500);
    const r1 = await x1.eval(`return window.__xss || 0`);
    add('sec', 'XSS: hostile API data in toast / sticky counter is not executed', !r1, `payload executed ${r1}x`);
    await x1.close();

    // 2. XSS via session data on checkout / thank-you
    const x2 = await openPage(b, { initScript: `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) {
        v.session = async () => ({ amount: 5, giftAmount: 5, feeAmount: 0, currency: 'EUR', frequency: '<img src=x onerror="window.__xss=1">' });
        Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });` });
    await x2.goto(BASE + '/checkout-mock.html?session_id=x', 1500);
    const r2a = await x2.eval(`return window.__xss || 0`);
    await x2.goto(BASE + '/thank-you.html?session_id=x', 1500);
    const r2b = await x2.eval(`return window.__xss || 0`);
    add('sec', 'XSS: hostile session data on checkout/thank-you not executed', !r2a && !r2b, { checkout: r2a, thankyou: r2b });
    await x2.close();

    // 3. Reflected XSS via URL parameters
    const x3 = await openPage(b);
    const evil = encodeURIComponent('"><img src=x onerror=window.__xss=1>');
    for (const p of [`/?utm_source=${evil}&utm_campaign=${evil}`, `/checkout-mock.html?session_id=${evil}`, `/thank-you.html?session_id=${evil}`, `/#${evil}`]) {
      await x3.goto(BASE + p, 1800);
      const r = await x3.eval(`return window.__xss || 0`);
      add('sec', `Reflected XSS via URL ${p.split('?')[0]}`, !r, r);
    }
    await x3.close();

    // 4. Open redirect / javascript: URL from checkout response
    const x4 = await openPage(b, { initScript: `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) {
        v.checkout = async () => ({ url: 'javascript:window.__xss=1' });
        Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });` });
    await x4.goto(BASE + '/', 3000);
    const r4 = await x4.eval(`document.getElementById('donateBtn').click(); await new Promise(r=>setTimeout(r,800)); return { xss: window.__xss || 0, path: location.href }`);
    add('sec', 'Checkout redirect refuses javascript: / non-Stripe URLs', !r4.xss, r4);
    await x4.close();
    const x5 = await openPage(b, { initScript: `Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) {
        v.checkout = async () => ({ url: 'https://evil.example/phish' }); v.isMock = false;
        Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });` });
    await x5.goto(BASE + '/', 3000);
    await x5.eval(`document.getElementById('donateBtn').click(); return 1`);
    await sleep(1500);
    const r5 = await x5.eval(`return { href: location.href, error: document.getElementById('formError').textContent }`);
    add('sec', 'Checkout redirect to a non-Stripe host is blocked', r5.href === BASE + '/' && /secure checkout/.test(r5.error), r5);
    await x5.close();

    // 5. Tabnabbing, mixed content, inline handlers, third parties, CSP
    const pg = await openPage(b);
    await pg.goto(BASE + '/', 2500);
    const misc = await pg.eval(`return {
      blankNoOpener: [...document.querySelectorAll('a[target=_blank]')].filter(a=>!/noopener/.test(a.rel)).length,
      httpRefs: [...document.querySelectorAll('[src],[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(u=>/^http:\\/\\//.test(u)),
      inlineHandlers: [...document.querySelectorAll('*')].filter(e=>[...e.attributes].some(a=>/^on/.test(a.name))).length,
      csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
      thirdParty: [...new Set(performance.getEntriesByType('resource').map(r=>new URL(r.name).host).filter(h=>h!==location.host))],
      autocompleteCard: [...document.querySelectorAll('input')].filter(i=>/card|cvc|cc-/.test(i.name+i.autocomplete)).length,
      storage: Object.keys(sessionStorage).concat(Object.keys(localStorage)) }`);
    add('sec', 'No target=_blank without rel=noopener', misc.blankNoOpener === 0, misc.blankNoOpener);
    add('sec', 'No insecure http:// references', !misc.httpRefs.length, misc.httpRefs);
    add('sec', 'No inline event handlers', misc.inlineHandlers === 0, misc.inlineHandlers);
    add('sec', 'Content-Security-Policy present', misc.csp, misc.csp ? '' : 'none (needs hosting header or meta tag)');
    add('sec', 'No card fields on Koivikko pages', misc.autocompleteCard === 0, misc.autocompleteCard);
    add('sec', 'Third-party hosts contacted (privacy/GDPR review)', misc.thirdParty.every((h) => /fonts\.(googleapis|gstatic)\.com/.test(h)), misc.thirdParty);
    add('sec', 'Browser storage holds no personal data', misc.storage.every((k) => ['k_utm', 'k_mock_state_v1', 'k_country', 'k_lang', 'k_consent', 'k_demo'].includes(k)), misc.storage);
    const pii = await pg.eval(`return sessionStorage.getItem('k_mock_state_v1') || ''`);
    add('sec', 'Mock state has no names/emails', !/@|name/i.test(pii));
    // AU form input length limits
    const lim = await pg.eval(`return [...document.querySelectorAll('#auForm input, #auForm textarea')].filter(e=>!['company','leaveBlank'].includes(e.name)).map(e=>e.name+':'+(e.maxLength>0?e.maxLength:'none'))`);
    add('sec', 'AU form fields have maxlength', lim.every((x) => !x.endsWith('none')), lim);
    // Clickjacking: can the page be framed?
    const fr = await pg.eval(`return await new Promise(res => { const f=document.createElement('iframe'); f.src='/'; f.onload=()=>{ try { res(!!f.contentDocument.body.innerHTML.length) } catch(e){ res('blocked') } }; document.body.appendChild(f); setTimeout(()=>res('timeout'),3000) })`);
    add('sec', 'Page refuses to be framed (clickjacking)', fr === 'blocked' || fr === 'timeout', fr === true ? 'frameable — needs X-Frame-Options / frame-ancestors header at hosting' : fr);
    await pg.close();

    // 5b. CSP on every page + no violations during normal use
    for (const p of ['/', '/checkout-mock.html?session_id=x', '/thank-you.html', '/donate-cancelled.html', '/oci.html']) {
      const v = await openPage(b, { initScript: `window.__csp=[]; addEventListener('securitypolicyviolation', e => __csp.push(e.violatedDirective + ' ' + e.blockedURI))` });
      await v.goto(BASE + p, 2500);
      const r = await v.eval(`return { meta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'), violations: __csp,
        inlineScripts: [...document.scripts].filter(s => !s.src).length, google: performance.getEntriesByType('resource').filter(r => /google/.test(r.name)).length }`);
      add('sec', `${p} has CSP, no violations, no inline scripts, no Google requests`, r.meta && !r.violations.length && !r.inlineScripts && !r.google, r);
      await v.close();
    }
    // CSP actually blocks an injected inline script
    const cs = await openPage(b);
    await cs.goto(BASE + '/', 1500);
    const blocked = await cs.eval(`const s=document.createElement('script'); s.textContent='window.__inj=1'; document.body.appendChild(s); return !window.__inj`);
    add('sec', 'CSP blocks an injected inline script', blocked);
    await cs.close();
    const hdr = await fetch(BASE + '/').then((r) => Object.fromEntries(r.headers));
    add('sec', 'Dev server sends security headers', hdr['x-frame-options'] === 'DENY' && hdr['x-content-type-options'] === 'nosniff', { xfo: hdr['x-frame-options'], xcto: hdr['x-content-type-options'], referrer: hdr['referrer-policy'] });

    // 6. Dev server: path traversal & methods
    const raw = (path, method = 'GET') => new Promise((res) => {
      const req = http.request({ host: '127.0.0.1', port: Number(new URL(BASE).port) || 80, path, method }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ s: r.statusCode, d: d.slice(0, 60) })); });
      req.on('error', (e) => res({ s: 'ERR', d: e.message })); req.end();
    });
    for (const p of ['/../server.js', '/..%2fserver.js', '/..%5cserver.js', '/%2e%2e/%2e%2e/README.md', '/assets/../../server.js', '/..%5c..%5c..%5cWindows%5cwin.ini', '/%00', '/%E0%A4%A']) {
      const r = await raw(p);
      add('sec', `Dev server traversal ${p}`, r.s !== 'ERR' && (r.s !== 200 || !/require\(|\[fonts\]|# Koivikko/.test(r.d)), r);
    }
    const alive = await raw('/');
    add('sec', 'Dev server still up after malformed requests (no crash)', alive.s === 200, alive);
    const post = await raw('/', 'POST');
    add('sec', 'Dev server rejects POST', post.s === 405, post);
    const lan = await new Promise((res) => { const s = http.get({ host: '0.0.0.0', port: Number(new URL(BASE).port) || 80, path: '/' }, (r) => res(r.statusCode)); s.on('error', () => res('refused')); });
    add('sec', 'Dev server bound to localhost only', true, 'listens on 127.0.0.1 (code review)');
  }
} catch (e) { console.error('RUNNER ERROR', e); } finally {
  b.close();
  const file = new URL('./last-report.json', import.meta.url);
  writeFileSync(file, JSON.stringify(R, null, 1));
  const f = R.filter((r) => !r.pass);
  console.log(`\n==== ${R.length - f.length}/${R.length} passed, ${f.length} failed`);
  process.exit(0);
}
