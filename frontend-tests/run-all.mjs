// Runs every test set for the live site and prints one summary.
//   1. Start the preview:   node frontend-tests/server.js      (http://localhost:3001)
//   2. Run the tests:       node frontend-tests/run-all.mjs
// Needs Chrome, Chromium or Edge (headless; BROWSER=path to choose) and internet for the accessibility checker (axe-core).
// Use BASE=http://... to point at another address.
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sets = [['tests.mjs', ['all']], ...readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => [f, []])];
const summary = []; let total = 0; let failed = 0; let log = '';
for (const [file, args] of sets) {
  process.stdout.write(`running ${file} … `);
  const r = spawnSync(process.execPath, [join(here, file), ...args], { encoding: 'utf8', env: process.env, maxBuffer: 50 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  log += `\n===== ${file}\n${out}`;
  const pass = (out.match(/^PASS/gm) || []).length; const fail = (out.match(/^FAIL/gm) || []).length;
  const crashed = /RUNNER ERROR|Error: /.test(out) && !pass;
  total += pass + fail; failed += fail + (crashed ? 1 : 0);
  summary.push(`${fail || crashed ? 'FAIL' : 'ok  '}  ${file.padEnd(22)} ${pass} passed${fail ? `, ${fail} failed` : ''}${crashed ? ' (crashed)' : ''}`);
  console.log(fail || crashed ? `${fail} failed` : `${pass} passed`);
  out.split('\n').filter((l) => /^FAIL/.test(l)).forEach((l) => console.log('   ' + l.slice(0, 220)));
}
writeFileSync(join(here, 'last-run.txt'), log);
console.log('\n' + summary.join('\n'));
console.log(`\n==== ${total - failed}/${total} checks passed${failed ? `, ${failed} FAILED` : ''}   (full log: frontend-tests/last-run.txt)`);
process.exit(failed ? 1 : 0);
