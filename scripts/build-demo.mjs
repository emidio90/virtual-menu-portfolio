import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env, VITE_APP_MODE: 'demo' } });
if (result.status !== 0) process.exit(result.status || 1);
const files = await readdir('dist/assets');
for (const file of files.filter(name => name.endsWith('.js'))) {
  const text = await readFile(`dist/assets/${file}`, 'utf8');
  if (/identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|\/api\/checkout|signInWithEmailAndPassword/.test(text)) throw new Error('Unexpected integration code in static demo build');
}
console.log('Static demo build verified. Deploy only dist with firebase.hosting.json.');
