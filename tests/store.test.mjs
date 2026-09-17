import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.mjs';
test('serialized updates survive restart without lost writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'barmeto-test-'));
  try {
    const store = await createStore(dir);
    await Promise.all(Array.from({length:20},(_,i) => store.change(s => s.audit.push({ id:i }))));
    assert.equal((await createStore(dir)).read().audit.length,20);
    const detached = store.read(); detached.audit.length = 0;
    assert.equal(store.read().audit.length,20);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('corrupted data uses backup and a rejected mutation leaves state intact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'barmeto-test-'));
  try {
    const store = await createStore(dir);
    await store.change(s => { s.settings.headless = false; });
    await store.change(s => { s.settings.headless = true; });
    await assert.rejects(store.change(s => { s.settings.headless = false; throw Error('reject'); }));
    assert.equal(store.read().settings.headless,true);
    await writeFile(path.join(dir,'workspace.json'),'{invalid');
    const recovered = await createStore(dir);
    assert.equal(recovered.read().settings.headless,false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
