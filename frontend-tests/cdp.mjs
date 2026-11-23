// Minimal headless-Edge driver over the DevTools protocol (no dependencies).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { existsSync } from 'node:fs';
// Headless Chromium-family browser. Set BROWSER=/path/to/chrome to choose another one.
const EDGE = process.env.BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((f) => existsSync(f));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ windowSize = '1366,860' } = {}) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const prof = mkdtempSync(join(tmpdir(), 'edgetest-'));
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--disable-extensions', '--disable-component-extensions-with-background-pages', `--remote-debugging-port=${port}`,
    `--user-data-dir=${prof}`, `--window-size=${windowSize}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  return { port, proc, close: () => proc.kill() };
}

export async function openPage(browser, { width = 1366, height = 860, mobile, initScript, fresh = false, country, real = false } = {}) {
  const t = await (await fetch(`http://127.0.0.1:${browser.port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  const log = { console: [], exceptions: [], failed: [], responses: [], dialogs: [] };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || { error: m.error }); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      log.console.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') log.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) log.failed.push(m.params.errorText + ' ' + (reqUrls[m.params.requestId] || ''));
    if (m.method === 'Network.requestWillBeSent') reqUrls[m.params.requestId] = m.params.request.url;
    if (m.method === 'Network.responseReceived') log.responses.push({ url: m.params.response.url, status: m.params.response.status, type: m.params.type });
    if (m.method === 'Network.loadingFinished') sizes[m.params.requestId] = m.params.encodedDataLength;
    if (m.method === 'Page.javascriptDialogOpening') { log.dialogs.push(m.params.message); cmd('Page.handleJavaScriptDialog', { accept: true }); }
    if (m.method === 'Page.loadEventFired') { loadWaiters.splice(0).forEach((r) => r()); }
  });
  const loadWaiters = [];
  const reqUrls = {}; const sizes = {};
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Page.enable');
  await cmd('Network.setCacheDisabled', { cacheDisabled: true });
  await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: mobile ?? width < 768 });
  // Returning visitor by default (country already answered); pass fresh:true to see the country popup
  // Demo data (?demo=1 equivalent) unless real:true; returning visitor (country + cookie choice made) unless fresh:true
  if (!real) await cmd('Page.addScriptToEvaluateOnNewDocument', { source: "try { sessionStorage.setItem('k_demo', '1') } catch (e) {}" });
  if (!fresh) await cmd('Page.addScriptToEvaluateOnNewDocument', { source: "try { if (!localStorage.getItem('k_country')) localStorage.setItem('k_country', '" + (country || 'US') + "'); if (!localStorage.getItem('k_consent')) localStorage.setItem('k_consent', JSON.stringify({ choice: 'denied', at: Date.now() })) } catch (e) {}" });
  if (initScript) await cmd('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
  const page = {
    log, cmd, sizes, reqUrls,
    // Wait for the real load event (max 20s) before the fixed settle time, so slow test runs
    // never measure a half-loaded page (e.g. buttons before the stylesheet applies).
    async goto(url, wait = 2500) {
      const loaded = new Promise((r) => loadWaiters.push(r));
      await cmd('Page.navigate', { url });
      await Promise.race([loaded, sleep(20000)]);
      await sleep(wait);
    },
    async eval(expr) {
      const r = await cmd('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
      return r.result?.value;
    },
    async close() { ws.close(); await fetch(`http://127.0.0.1:${browser.port}/json/close/${t.id}`).catch(() => {}); },
  };
  return page;
}
