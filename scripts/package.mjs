import { cp, mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
await mkdir('.desktop', { recursive: true });
await cp('.next/standalone', '.desktop/server', { recursive: true });
// Next standalone copies environment files. Never distribute them with installers.
const serverDirectory = path.resolve('.desktop/server');
for (const name of await readdir(serverDirectory)) {
  if (name === '.env' || name.startsWith('.env.')) await rm(path.join(serverDirectory, name));
}
await cp('.next/static', '.desktop/server/.next/static', { recursive: true });
await cp('public', '.desktop/server/public', { recursive: true });
await cp('workers', '.desktop/workers', { recursive: true });
await cp('lib', '.desktop/lib', { recursive: true });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const dependencies = Object.fromEntries(['playwright','node-cron','cron-parser','zod','semver'].map(name => [name, pkg.dependencies[name]]));
await writeFile('.desktop/package.json', JSON.stringify({ name: 'barmeto-runtime', version: pkg.version, private: true, dependencies }, null, 2));
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev'], { cwd: path.resolve('.desktop'), stdio: 'inherit', shell: process.platform === 'win32' });
const cacheRoot = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
const browserManifest = JSON.parse(await readFile('node_modules/playwright-core/browsers.json','utf8'));
let copied = true;
for (const browser of browserManifest.browsers.filter(b => ['chromium','chromium-headless-shell','ffmpeg'].includes(b.name))) {
  const directory = `${browser.name.replaceAll('-','_')}-${browser.revision}`;
  try { await access(path.join(cacheRoot,directory)); }
  catch { copied = false; break; }
  await cp(path.join(cacheRoot,directory),path.join('.desktop/browsers',directory),{recursive:true});
}
if (!copied) execFileSync(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium'], { cwd: path.resolve('.desktop'), env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.resolve('.desktop/browsers'), PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:'120000' }, stdio: 'inherit' });
