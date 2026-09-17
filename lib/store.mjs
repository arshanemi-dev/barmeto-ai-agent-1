import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function initialState() {
  return { schemaVersion: 1, workflows: [], runs: [], schedules: [], occurrences: [], rules: [], applications: [], audit: [], settings: { headless: true, timezone: 'Asia/Kolkata' } };
}
export async function createStore(directory) {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'workspace.json');
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') {
      try { data = JSON.parse(await readFile(file + '.backup', 'utf8')); }
      catch { throw new Error('Workspace data is unreadable. Restore workspace.json from a backup before continuing.'); }
    } else data = initialState();
  }
  if (data.schemaVersion !== 1) throw new Error('Unsupported workspace version.');
  let chain = Promise.resolve();
  return {
    read: () => structuredClone(data),
    change(mutator) {
      const job = chain.then(async () => {
        const next = structuredClone(data);
        const result = mutator(next);
        const temp = file + '.tmp';
        await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
        try { await copyFile(file, file + '.backup'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        await rename(temp, file);
        data = next;
        return result;
      });
      chain = job.catch(() => {});
      return job;
    },
  };
}
export function audit(state, action, target) {
  state.audit.unshift({ id: randomUUID(), action, target, at: new Date().toISOString() });
  state.audit = state.audit.slice(0, 200);
}
