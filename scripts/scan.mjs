import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const skip = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', '.firebase']);
const findings = [];
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(item.name)) continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) { await scan(file); continue; }
    if (item.name.startsWith('.env') && item.name !== '.env.example') findings.push(`${file}: local environment file must not enter a release`);
    if (/service[-_]?account.*\.json$/i.test(item.name)) findings.push(`${file}: credential file`);
    if (item.name === 'package-lock.json') continue;
    const content = await readFile(file, 'utf8');
    for (const [label, pattern] of [
      ['private key', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
      ['provider secret', /(?:sk_live_|sk_test_|whsec_|AIza)[A-Za-z0-9_-]{20,}/],
      ['GitHub credential', /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/],
    ]) if (pattern.test(content)) findings.push(`${file}: possible ${label}`);
  }
}
await scan('.');
if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1; }
else console.log('Release scan passed: no credential-pattern or local environment-file matches. This is not a full secret-history audit.');
