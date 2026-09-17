const { app, BrowserWindow, session, utilityProcess, dialog } = require('electron');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');
let window, children = [];
if (process.env.BARMETO_SMOKE_TEST === '1') { const folder = path.resolve('.barmeto/desktop-smoke'); fs.mkdirSync(folder,{recursive:true}); app.setPath('userData',folder); }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Barmeto could not start', error.message); app.quit(); });
}
function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function start() {
  let url = process.env.BARMETO_DEV_URL;
  const token = process.env.BARMETO_LOCAL_TOKEN || randomBytes(32).toString('hex');
  if (!url) {
    const port = await freePort(), servicePort = await freePort();
    const root = path.join(process.resourcesPath, 'runtime');
    const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', BARMETO_DESKTOP: '1', BARMETO_LOCAL_TOKEN: token, BARMETO_SERVICE_TOKEN: randomBytes(32).toString('hex'), BARMETO_SERVICE_PORT: String(servicePort), BARMETO_DATA_DIR: app.getPath('userData'), PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'browsers') };
    children.push(utilityProcess.fork(path.join(root, 'workers/service.mjs'), [], { env, cwd: root, stdio: 'pipe' }));
    children.push(utilityProcess.fork(path.join(root, 'server/server.js'), [], { env, cwd: path.join(root, 'server'), stdio: 'pipe' }));
    for (const child of children) child.stderr?.on('data', data => console.error(data.toString()));
    url = `http://127.0.0.1:${port}`;
  }
  const origin = new URL(url).origin;
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => { details.requestHeaders['x-barmeto-token'] = token; callback({ requestHeaders: details.requestHeaders }); });
  session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(`${url}/api/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw Error('The local server did not become ready. Check runtime logs and retry.');
  window = new BrowserWindow({ show:process.env.BARMETO_SMOKE_TEST !== '1', width: 1440, height: 960, minWidth: 420, minHeight: 600, title: 'Barmeto', backgroundColor: '#f5f6f8', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== origin) event.preventDefault(); });
  await window.loadURL(url);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { for (const child of children) child.kill(); });
