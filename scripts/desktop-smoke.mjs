import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
await mkdir('.barmeto',{recursive:true});
const app = await electron.launch({executablePath:path.resolve('dist/win-unpacked/Barmeto.exe'),env:{...process.env,BARMETO_SMOKE_TEST:'1'},timeout:90000});
try {
  const page = await app.firstWindow({timeout:90000});
  await page.getByRole('heading',{name:'Your work. On autopilot.'}).waitFor();
  await page.getByText('Local runtime connected',{exact:true}).waitFor({timeout:30000});
  await page.screenshot({path:'.barmeto/desktop-preview.png',fullPage:true});
  console.log('Packaged Electron UI and local runtime started successfully.');
  const origin = new URL(page.url()).origin;
  await page.getByRole('button',{name:'Create workflow',exact:true}).click();
  const dialog = page.getByRole('dialog');
  const name = `Desktop smoke ${Date.now()}`;
  await dialog.getByLabel('Workflow name').fill(name);
  await dialog.getByLabel('Approved website origins').fill(origin);
  await dialog.getByLabel('Page URL').fill(`${origin}/fixture.html`);
  await dialog.getByRole('button',{name:'Add step',exact:true}).click();
  await dialog.getByLabel('Element selector').fill('h1');
  await dialog.getByRole('button',{name:'Save workflow'}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:`Run ${name}`,exact:true}).click();
  await page.getByRole('dialog').getByText('All steps completed.').waitFor({timeout:60000});
  await page.getByRole('dialog').getByText('Automation verified',{exact:true}).waitFor();
  console.log('Bundled Playwright browser executed and verified a real workflow.');
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.screenshot({path:'.barmeto/desktop-preview.png',fullPage:true});
} finally {await app.close();}
