import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
const env = { ...process.env, BARMETO_SERVICE_TOKEN: randomBytes(32).toString('hex'), BARMETO_SERVICE_PORT: process.env.BARMETO_SERVICE_PORT || '4318' };
const webOnly = process.argv.includes('--web');
env.BARMETO_DESKTOP = webOnly ? '0' : '1';
env.BARMETO_LOCAL_TOKEN = randomBytes(32).toString('hex');
const children = [];
function run(file, args = []) { const p = spawn(process.execPath, [file, ...args], { stdio: 'inherit', env, windowsHide: true }); children.push(p); return p; }
run('workers/service.mjs');
const port = process.env.PORT || '3000';
run('node_modules/next/dist/bin/next', ['dev', '--webpack', '--hostname', '127.0.0.1', '--port', port]);
if (!webOnly) {
  const electronPath = (await import('electron')).default;
  const p = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...env, BARMETO_DEV_URL: `http://127.0.0.1:${port}` }, windowsHide: true });
  children.push(p); p.on('exit', () => stop());
}
let stopping = false;
function stop() { if (stopping) return; stopping = true; children.forEach(p => p.kill()); setTimeout(() => process.exit(), 600); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(); });
  child.on('exit', () => stop());
}
