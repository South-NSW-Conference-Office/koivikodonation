// ?demo=1 (demo numbers + preview checkout) works only on localhost and the sandbox, never on the live site.
// Runs site/config.js with a pretend address; no browser needed.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../site/config.js', import.meta.url), 'utf8');
let fails = 0; const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, JSON.stringify(d)); };
function mockApiFor(href, stored = null) {
  const u = new URL(href);
  const store = new Map(stored ? [['k_demo', stored]] : []);
  const sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const ctx = { window: {}, location: { protocol: u.protocol, hostname: u.hostname, search: u.search }, URLSearchParams, sessionStorage };
  vm.runInNewContext(src, ctx);
  return { mock: ctx.window.KOIVIKKO_CONFIG.mockApi, stored: store.get('k_demo') ?? null };
}
const cases = [
  ['http://localhost:3001/?demo=1', true],
  ['http://127.0.0.1:3001/?demo=1', true],
  ['https://koivikko-give-sandbox.koivikko-donate-backend.workers.dev/?demo=1', true],
  ['https://give.koivikko.org/?demo=1', false],
  ['https://give.koivikko.org/', false],
  ['http://localhost:3001/', false],
];
for (const [href, want] of cases) { const r = mockApiFor(href); R(r.mock === want, `${href} → demo ${want}`, r); }
const live = mockApiFor('https://give.koivikko.org/', '1');
R(live.mock === false && live.stored === null, 'Live site: a demo flag left in the tab is ignored and cleared', live);
R(mockApiFor('http://localhost:3001/', '1').mock === true, 'Localhost: the demo flag is remembered for the tab');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
