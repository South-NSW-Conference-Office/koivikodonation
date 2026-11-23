import { launch, openPage } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
const page = new URL('../site/index.html', import.meta.url).href; // the page opened straight from disk (demo mode)
const live = await fetch('https://koivikko-donate-sandbox.koivikko-donate-backend.workers.dev/stats', {
  headers: { Origin: 'https://koivikko-give-sandbox.koivikko-donate-backend.workers.dev' } }).then((r) => r.json());
console.log('live backend says:', JSON.stringify(live));
const stub = (stats) => `Object.defineProperty(window, 'KOIVIKKO_CONFIG', { configurable: true, set(v) { v.counterMinDonors = 1; Object.defineProperty(window, 'KOIVIKKO_CONFIG', { value: v, writable: true }); } }); Object.defineProperty(window, 'KoivikkoApi', { configurable: true, set(v) { v.stats = async () => (${JSON.stringify(stats)});
  Object.defineProperty(window, 'KoivikkoApi', { value: v, writable: true }); } });`;
const read = `return { hidden: document.getElementById('counter').hidden, text: document.querySelector('.counter-line').textContent.replace(/\\s+/g,' ').trim() }`;
const cases = [
  ['Demo mode (EUR 1,540)', null, /A\$2,695/],
  // The backend sends AUD once COUNTER_CURRENCY is deployed; before that it sends EUR and the page converts
  ['Live sandbox numbers', live, new RegExp('A\\$' + Math.round(live.monthlyPledgedTotal * (live.currency === 'AUD' ? 1 : 1.75)).toLocaleString('en'))],
  ['Backend already sends AUD 500', { ...live, monthlyPledgedTotal: 500, currency: 'AUD' }, /A\$500/],
  ['Backend sends USD 100', { ...live, monthlyPledgedTotal: 100, currency: 'USD' }, /A\$153/],
];
const b = await launch();
let fails = 0;
try {
  for (const [name, stats, expect] of cases) {
    const p = await openPage(b, stats ? { initScript: stub(stats) } : {});
    await p.goto(page, 3000);
    const r = await p.eval(read);
    const ok = !r.hidden && expect.test(r.text) && !/€/.test(r.text);
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${r.hidden ? '(hidden)' : r.text}`, p.log.exceptions.length ? p.log.exceptions : '');
    await p.close();
  }
} finally { b.close(); console.log(fails ? `${fails} failed` : 'all passed'); process.exit(0); }
