// Koivikko donation landing page: LOCAL PREVIEW SERVER for ../site (static files only)
// Zero dependencies. Run:  node frontend-tests/server.js  →  http://localhost:3001
//
// Add ?demo=1 to use the page's built-in demo data (no backend needed). Without it the
// page calls the local backend at localhost:8787. See backend/README.md for the contract.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const PUBLIC = path.join(__dirname, '..', 'site');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2',
};
// Pretty URLs from the PRD (§6.11, §6.12, hreflang /en /fi)
const ROUTES = { '/': '/index.html', '/en': '/index.html', '/fi': '/index.html',
  '/thank-you': '/thank-you.html', '/donate-cancelled': '/donate-cancelled.html' };

// Same headers as the live site: the "/*" block of site/_headers (read once at start).
// Sent on EVERY response, errors included.
function readHeaders() {
  const out = {};
  let inAll = false;
  try {
    for (const raw of fs.readFileSync(path.join(PUBLIC, '_headers'), 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^(\/|[^\s]+:\/\/)/.test(line)) { inAll = line === '/*'; continue; }
      const i = line.indexOf(':');
      if (inAll && i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch { /* no _headers file: fall back to the basics below */ }
  return { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', ...out };
}
const SECURITY_HEADERS = readHeaders();
const send = (res, status, headers = {}, body) => { res.writeHead(status, { ...SECURITY_HEADERS, ...headers }); res.end(body); };

http.createServer((req, res) => {
  // Malformed URLs (e.g. "/%E0%A4%A" or a null byte) used to throw and crash the server.
  let file;
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { return send(res, 405, { Allow: 'GET, HEAD' }); }
    const url = new URL(req.url, 'http://localhost');
    const p = ROUTES[url.pathname] || decodeURIComponent(url.pathname);
    if (p.includes('\0')) throw new Error('null byte');
    file = path.normalize(path.join(PUBLIC, p));
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request');
  }
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err || path.basename(file) === '_headers') return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
    send(res, 200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Koivikko mockup: http://localhost:${PORT}`));
