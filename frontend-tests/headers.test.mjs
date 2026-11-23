// HTTP headers: site/_headers (Cloudflare sandbox copy), deploy/snsw/security-headers.conf (the
// live site on snswserver) and the preview server.
// Run:  node frontend-tests/server.js   then   node frontend-tests/headers.test.mjs
// To check a real deployment too:  LIVE=https://give.koivikko.org node frontend-tests/headers.test.mjs
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const B = process.env.BASE || 'http://localhost:3001';
const PORT = Number(new URL(B).port) || 80;
let fails = 0;
const R = (ok, name, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, typeof d === 'string' ? d : JSON.stringify(d)); };

// Every page and file must carry these (lower-case names, exact values)
const MUST = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
};
const missing = (h) => Object.entries(MUST).filter(([k, v]) => h[k] !== v).map(([k]) => k);

// 1. The file itself, read the way Cloudflare reads it
const text = readFileSync(fileURLToPath(new URL('../site/_headers', import.meta.url)), 'utf8');
const rules = {}; let cur = null; const bad = [];
text.split('\n').forEach((raw, i) => {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return;
  if (/^([^\s]+:\/\/|\/)/.test(line)) { cur = line; rules[cur] = {}; return; }
  const c = line.indexOf(':');
  if (!cur || c < 1 || /\s/.test(line.slice(0, c).trim())) { bad.push(i + 1); return; }
  rules[cur][line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
});
R(!bad.length, '_headers: every line is a path, a header or a comment', bad.length ? { badLines: bad } : '');
R(rules['/*'] && !missing(rules['/*']).length, '_headers: "/*" sends all security headers', rules['/*'] ? missing(rules['/*']) : 'no /* rule');
const pp = (rules['/*'] || {})['permissions-policy'] || '';
R(['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].every((f) => pp.includes(f)) && !/attribution-reporting/.test(pp),
  '_headers: Permissions-Policy turns off camera, microphone, location, payment sheet (Ads attribution left alone)', pp);
R(!/noindex/i.test(JSON.stringify(rules['/*'] || {})), '_headers: the live site is NOT hidden from search engines');
const sandbox = Object.keys(rules).find((k) => /koivikko-donate-backend\.workers\.dev/.test(k));
R(sandbox && /noindex/.test(rules[sandbox]['x-robots-tag'] || ''), '_headers: the sandbox copy on workers.dev is hidden from search engines', sandbox || 'no rule');

// The snswserver container (deploy/snsw) sends the same headers from its nginx config. HSTS is
// the one exception: the shared nginx-proxy in front of it adds that one itself.
const ngx = readFileSync(fileURLToPath(new URL('../deploy/snsw/security-headers.conf', import.meta.url)), 'utf8');
const ngxH = {};
for (const m of ngx.matchAll(/^\s*add_header\s+([\w-]+)\s+"([^"]*)"\s+always;/gm)) ngxH[m[1].toLowerCase()] = m[2];
const cfH = { ...(rules['/*'] || {}) }; delete cfH['strict-transport-security'];
R(JSON.stringify(Object.entries(ngxH).sort()) === JSON.stringify(Object.entries(cfH).sort()) && !ngxH['strict-transport-security'],
  'deploy/snsw nginx headers = _headers "/*" (minus HSTS, which the SNSW proxy adds)', { nginx: ngxH, headers: cfH });

// The page's own <meta> policy must not be weakened by the header (both are applied)
const html = readFileSync(fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');
R(/http-equiv="Content-Security-Policy"[^>]*script-src 'self'/.test(html) && !/script-src[^;"]*'unsafe-inline'/.test(html), 'index.html keeps its strict script policy (no inline scripts)');

// 2. The preview server sends them on every response, errors included
const raw = (base, path, method = 'GET', host) => new Promise((res) => {
  const u = new URL(base);
  const lib = u.protocol === 'https:' ? https : http;
  const q = lib.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path, method, headers: host ? { Host: host } : {} },
    (s) => { s.resume(); s.on('end', () => res({ s: s.statusCode, h: s.headers })); });
  q.on('error', () => res({ s: 'ERR', h: {} })); q.setTimeout(8000, () => q.destroy()); q.end();
});
const local = `http://127.0.0.1:${PORT}`;
const seen = {};
for (const [path, m] of [['/', 'GET'], ['/app.js', 'GET'], ['/assets/img/flags/fi.svg', 'GET'], ['/nope.html', 'GET'], ['/..%2fserver.js', 'GET'], ['/%E0%A4%A', 'GET'], ['/', 'PUT']]) {
  const x = await raw(local, path, m);
  seen[`${m} ${path} (${x.s})`] = missing(x.h).length ? missing(x.h) : 'ok';
}
R(Object.values(seen).every((v) => v === 'ok'), 'Preview server: security headers on every response (200, 404, 403, 400, 405)', seen);
R((await raw(local, '/_headers')).s === 404, 'Preview server: the _headers file itself is not served');
const streams = {};
for (const path of ['/index.html::$DATA', '/config.js::$DATA', '/config.js.', '/config.js%20', '/app.js%3A%3A%24DATA']) streams[path] = (await raw(local, path)).s;
R(Object.values(streams).every((s) => s === 400 || s === 404), 'Preview server: Windows stream names and trailing dot/space are refused', streams);

// 3. Optional: a real deployment (or `wrangler dev -c ../wrangler.site.toml`)
if (process.env.LIVE) {
  for (const path of ['/', '/thank-you', '/nope.html']) {
    const x = await raw(process.env.LIVE, path);
    R(!missing(x.h).length, `LIVE ${path} (${x.s}): security headers present`, missing(x.h));
  }
  const g = await raw(process.env.LIVE, '/_headers');
  R(g.s === 404, 'LIVE: the _headers file itself is not published', String(g.s));
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(0);
