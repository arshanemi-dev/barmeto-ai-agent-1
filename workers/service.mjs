import http from 'node:http';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import cron from 'node-cron';
import semver from 'semver';
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { chromium } from 'playwright';
import { createStore, audit } from '../lib/store.mjs';
import { workflowSchema, scheduleSchema, ruleSchema, previewSchedule, evaluateRules, domainMatches } from '../lib/contracts.mjs';

const directory = process.env.BARMETO_DATA_DIR || path.resolve('.barmeto');
const store = await createStore(directory);
const token = process.env.BARMETO_SERVICE_TOKEN;
if (!token) throw new Error('Service token is required.');
let active = null;
let pumping = false;
let closing = false;
const timers = new Map();
const now = () => new Date().toISOString();
await store.change(s => { for (const r of s.runs) if (['running','queued'].includes(r.status)) { r.status = 'interrupted'; r.finishedAt = now(); r.error = 'The runtime stopped. Review completed steps before starting again.'; } });

async function event(id, message, status = 'info') {
  await store.change(s => { const r = s.runs.find(x => x.id === id); if (r) r.events.push({ at: now(), message, status }); });
}
async function enqueue(workflow, source = 'manual', occurrenceKey = null) {
  let id;
  await store.change(s => {
    if (occurrenceKey && s.occurrences.some(o => o.key === occurrenceKey)) return;
    if (s.runs.filter(r => ['queued','running'].includes(r.status)).length >= 10) throw Error('The queue is full. Wait for a task to finish.');
    const denied = evaluateRules(workflow, s.rules, source !== 'manual');
    if (denied) throw Error(`Blocked by rule: ${denied}`);
    id = randomUUID();
    s.runs.unshift({ id, workflowId: workflow.id, name: workflow.name, workflow: structuredClone(workflow), source, status: 'queued', createdAt: now(), events: [], outputs: [], currentStep: 0 });
    if (occurrenceKey) s.occurrences.unshift({ key: occurrenceKey, runId: id, at: now(), status: 'queued' });
    audit(s, 'Run queued', workflow.name);
  });
  void pump(); return id;
}
async function pump() {
  if (pumping || closing) return;
  pumping = true;
  try {
    for (;;) {
      const run = store.read().runs.find(r => r.status === 'queued');
      if (!run || closing) break;
      active = { id: run.id, cancelled: false, browser: null };
      await store.change(s => { const r = s.runs.find(x => x.id === run.id); r.status = 'running'; r.startedAt = now(); });
      const timeout = setTimeout(() => { if (active?.id === run.id) { active.timedOut = true; active.browser?.close().catch(() => {}); } }, 180000);
      try {
        const denied = evaluateRules(run.workflow, store.read().rules, run.source !== 'manual');
        if (denied) throw Error(`Blocked by rule: ${denied}`);
        const browser = await chromium.launch({ headless: store.read().settings.headless });
        active.browser = browser;
        if (active.cancelled || active.timedOut) throw Error('Run stopped before browser launch completed.');
        const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
        const origins = new Set(run.workflow.allowedOrigins.map(x => new URL(x).origin));
        await context.route('**/*', async route => {
          try {
            const request = route.request();
            const url = new URL(request.url());
            const rules = store.read().rules;
            if (rules.some(r => r.enabled && r.type === 'block-domain' && domainMatches(url.hostname, r.value))) return route.abort();
            if (request.isNavigationRequest() && !origins.has(url.origin)) return route.abort();
            return route.continue();
          } catch { return route.abort(); }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
        for (const [index, step] of run.workflow.steps.entries()) {
          if (active.cancelled || active.timedOut) throw Error('Run stopped.');
          const policy = evaluateRules(run.workflow, store.read().rules, run.source !== 'manual');
          if (policy) throw Error(`Blocked by rule: ${policy}`);
          await store.change(s => { s.runs.find(x => x.id === run.id).currentStep = index + 1; });
          await event(run.id, `Step ${index + 1}: ${step.type}`);
          if (step.type === 'navigate') await page.goto(step.target, { waitUntil: 'domcontentloaded' });
          if (step.type === 'click') await page.locator(step.target).click();
          if (step.type === 'fill') await page.locator(step.target).fill(step.value);
          if (step.type === 'wait') await page.waitForTimeout(Number(step.value));
          if (step.type === 'extract') {
            const value = (await page.locator(step.target).innerText()).slice(0, 10000);
            await store.change(s => s.runs.find(x => x.id === run.id).outputs.push({ type: 'text', label: step.target, value }));
          }
          if (step.type === 'screenshot') {
            const folder = path.join(directory, 'outputs', run.id);
            await mkdir(folder, { recursive: true });
            const filename = `step-${index + 1}.png`;
            await page.screenshot({ path: path.join(folder, filename), fullPage: true });
            await store.change(s => s.runs.find(x => x.id === run.id).outputs.push({ type: 'file', label: filename, value: path.join(folder, filename) }));
          }
        }
        if (active.cancelled || active.timedOut) throw Error('Run stopped.');
        await store.change(s => { const r = s.runs.find(x => x.id === run.id); r.status = 'succeeded'; r.finishedAt = now(); });
        await event(run.id, 'All steps completed.', 'success');
      } catch (error) {
        const cancelled = active.cancelled;
        await store.change(s => { const r = s.runs.find(x => x.id === run.id); r.status = cancelled ? 'cancelled' : 'failed'; r.finishedAt = now(); r.error = active.timedOut ? 'Run exceeded the three-minute limit.' : cancelled ? 'Stopped by you.' : error.message.split('\n')[0].slice(0, 300); });
      } finally {
        clearTimeout(timeout);
        await active.browser?.close().catch(() => {});
        active = null;
      }
    }
  } finally { pumping = false; }
}
async function fire(schedule, intended) {
  const key = `${schedule.id}:${schedule.revision}:${intended}`;
  const state = store.read();
  if (state.occurrences.some(o => o.key === key)) return;
  const current = state.schedules.find(s => s.id === schedule.id);
  if (!current?.enabled || current.revision !== schedule.revision) return;
  try {
    if (state.runs.some(r => r.source === schedule.id && ['queued','running'].includes(r.status))) throw Error('Previous occurrence is still queued or running.');
    await enqueue(schedule.workflowSnapshot, schedule.id, key);
  } catch (error) {
    await store.change(s => { if (!s.occurrences.some(o => o.key === key)) s.occurrences.unshift({ key, at: now(), status: 'skipped', reason: error.message }); });
  }
  await store.change(s => { const item = s.schedules.find(x => x.id === schedule.id); if (item?.revision === schedule.revision) { item.nextRun = previewSchedule(item.expression, item.timezone)[0]; item.lastOccurrence = intended; } });
}
async function registerSchedules() {
  for (const timer of timers.values()) timer.destroy();
  timers.clear();
  for (const schedule of store.read().schedules.filter(s => s.enabled)) {
    try {
      if (schedule.nextRun && new Date(schedule.nextRun) < new Date()) {
        const latest = CronExpressionParser.parse(schedule.expression, { tz: schedule.timezone }).prev().toISOString();
        if (schedule.missedPolicy === 'latest' && Date.now() - Date.parse(latest) < 3600000) await fire(schedule, latest);
        else await store.change(s => { s.occurrences.unshift({ key: `${schedule.id}:${schedule.revision}:${schedule.nextRun}`, at: now(), status: 'missed', reason: 'The scheduler was not available at the intended time.' }); });
      }
      await store.change(s => { s.schedules.find(x => x.id === schedule.id).nextRun = previewSchedule(schedule.expression, schedule.timezone)[0]; });
      timers.set(schedule.id, cron.schedule(schedule.expression, ctx => fire(schedule, ctx.date.toISOString()), { timezone: schedule.timezone, noOverlap: true }));
    } catch (error) { await store.change(s => { const item = s.schedules.find(x => x.id === schedule.id); item.enabled = false; item.error = error.message; }); }
  }
}
await registerSchedules();
const action = async (body) => {
  if (body.type === 'save-workflow') {
    const value = workflowSchema.parse(body.payload);
    const id = value.id || randomUUID();
    await store.change(s => {
      const old = s.workflows.find(w => w.id === id);
      const item = { ...value, id, revision: (old?.revision || 0) + 1, updatedAt: now() };
      s.workflows = [item, ...s.workflows.filter(w => w.id !== id)]; audit(s, 'Workflow saved', item.name);
    }); return { id };
  }
  if (body.type === 'delete-workflow') {
    await store.change(s => { if (s.schedules.some(x => x.workflowId === body.id)) throw Error('Remove this workflow’s schedules first.'); s.workflows = s.workflows.filter(w => w.id !== body.id); audit(s, 'Workflow removed', body.id); }); return {};
  }
  if (body.type === 'run') {
    const workflow = store.read().workflows.find(w => w.id === body.id);
    if (!workflow) throw Error('Workflow not found.');
    return { id: await enqueue(workflow) };
  }
  if (body.type === 'cancel') {
    if (active?.id === body.id) { active.cancelled = true; await active.browser?.close(); }
    else await store.change(s => { const r = s.runs.find(x => x.id === body.id); if (r?.status === 'queued') { r.status = 'cancelled'; r.finishedAt = now(); } }); return {};
  }
  if (body.type === 'preview-schedule') return { dates: previewSchedule(body.expression, body.timezone) };
  if (body.type === 'save-schedule') {
    const value = scheduleSchema.parse(body.payload);
    const dates = previewSchedule(value.expression, value.timezone);
    const workflow = store.read().workflows.find(w => w.id === value.workflowId);
    if (!workflow) throw Error('Choose an existing workflow.');
    await store.change(s => {
      const id = value.id || randomUUID(); const old = s.schedules.find(x => x.id === id);
      s.schedules = [{ ...value, id, revision: (old?.revision || 0) + 1, workflowSnapshot: structuredClone(workflow), nextRun: dates[0] }, ...s.schedules.filter(x => x.id !== id)]; audit(s, 'Schedule saved', value.name);
    }); await registerSchedules(); return {};
  }
  if (body.type === 'toggle-schedule' || body.type === 'delete-schedule') {
    await store.change(s => { if (body.type === 'delete-schedule') s.schedules = s.schedules.filter(x => x.id !== body.id); else { const item = s.schedules.find(x => x.id === body.id); if (!item) throw Error('Schedule not found.'); item.enabled = !item.enabled; item.revision++; item.nextRun = previewSchedule(item.expression, item.timezone)[0]; } audit(s, body.type, body.id); }); await registerSchedules(); return {};
  }
  if (body.type === 'save-rule') {
    const value = ruleSchema.parse(body.payload);
    await store.change(s => { const id = value.id || randomUUID(); const old = s.rules.find(r => r.id === id); s.rules = [{ ...value, id, revision: (old?.revision || 0) + 1 }, ...s.rules.filter(r => r.id !== id)]; audit(s, 'Rule saved', value.name); }); return {};
  }
  if (body.type === 'toggle-rule' || body.type === 'delete-rule') {
    await store.change(s => { if (body.type === 'delete-rule') s.rules = s.rules.filter(r => r.id !== body.id); else { const rule = s.rules.find(r => r.id === body.id); if (!rule) throw Error('Rule not found.'); rule.enabled = !rule.enabled; rule.revision++; } audit(s, body.type, body.id); }); return {};
  }
  if (body.type === 'settings') { await store.change(s => { if (typeof body.headless !== 'boolean') throw Error('Invalid settings.'); s.settings.headless = body.headless; }); return {}; }
  if (body.type === 'save-application') {
    const value = z.object({ name:z.string().trim().min(2).max(80), slug:z.string().min(2).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), description:z.string().max(300) }).parse(body.payload);
    await store.change(s => { if(s.applications.some(a => a.slug === value.slug)) throw Error('This tool slug is already registered.'); s.applications.unshift({ ...value,id:randomUUID(),createdAt:now(),releases:[] }); audit(s,'Tool registered',value.name); }); return {};
  }
  if (body.type === 'draft-release') {
    const value = z.object({ id:z.string().uuid(),changeType:z.enum(['first','patch','minor','major']),notes:z.string().trim().min(5).max(5000) }).parse(body);
    await store.change(s => {
      const app = s.applications.find(a => a.id === value.id); if(!app) throw Error('Application not found.');
      const previous = app.releases[0]?.version;
      if(previous && value.changeType === 'first') throw Error('A first release already exists.');
      const version = previous ? semver.inc(previous,value.changeType) : '1.0.0';
      app.releases.unshift({ id:randomUUID(),version,changeType:value.changeType,notes:value.notes,status:'draft',createdAt:now(),storagePrefix:`${app.slug}/${app.slug}_v${version}/win-x64/` }); audit(s,'Release drafted',`${app.name} ${version}`);
    }); return {};
  }
  throw Error('Unknown action.');
};
const server = http.createServer(async (req, res) => {
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); return res.end(); }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && req.url === '/state') {
      const state = store.read();
      // Passwords entered into fill steps are never echoed in run snapshots.
      state.runs = state.runs.map(({ workflow, ...r }) => ({ ...r, totalSteps: workflow.steps.length }));
      state.schedules = state.schedules.map(({ workflowSnapshot, ...s }) => ({ ...s, workflowRevision: workflowSnapshot.revision }));
      return res.end(JSON.stringify({ ...state, runtime: { online: true, activeRun: active?.id || null, dataDirectory: directory, version: '0.1.0' } }));
    }
    if (req.method !== 'POST' || req.url !== '/action') { res.writeHead(404); return res.end('{}'); }
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 128000) throw Error('Request is too large.'); }
    const result = await action(JSON.parse(raw)); res.end(JSON.stringify(result));
  } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.issues?.map(i => i.message).join(' ') || error.message })); }
});
server.listen(Number(process.env.BARMETO_SERVICE_PORT || 4318), '127.0.0.1', () => console.log('Barmeto runtime ready'));
async function stop() { closing = true; for (const timer of timers.values()) timer.destroy(); if (active) { active.cancelled = true; await active.browser?.close().catch(() => {}); } server.close(); setTimeout(() => process.exit(), 500).unref(); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
