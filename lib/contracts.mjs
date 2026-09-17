import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import cron from 'node-cron';
export const stepSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['navigate', 'click', 'fill', 'wait', 'extract', 'screenshot']),
  target: z.string().max(2000).default(''),
  value: z.string().max(10000).default(''),
});
export const workflowSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(2).max(80),
  description: z.string().max(300).default(''),
  steps: z.array(stepSchema).min(1).max(30),
  allowedOrigins: z.array(z.string().url().refine(v => /^https?:\/\//.test(v))).min(1).max(20),
}).superRefine((value, ctx) => {
  const ids = new Set();
  for (const step of value.steps) {
    if (ids.has(step.id)) ctx.addIssue({ code: 'custom', message: 'Step IDs must be unique.' });
    ids.add(step.id);
    if (step.type === 'navigate') {
      try { const url = new URL(step.target); if (!['http:', 'https:'].includes(url.protocol) || !value.allowedOrigins.some(o => new URL(o).origin === url.origin)) throw Error(); }
      catch { ctx.addIssue({ code: 'custom', message: 'Every navigation must use an approved HTTP(S) origin.' }); }
    }
    if (['click','fill','extract'].includes(step.type) && !step.target.trim()) ctx.addIssue({ code: 'custom', message: 'An element selector is required.' });
    if (step.type === 'wait' && (!/^\d+$/.test(step.value) || Number(step.value) > 10000)) ctx.addIssue({ code: 'custom', message: 'Wait must be 0–10000 milliseconds.' });
  }
});
export function previewSchedule(expression, timezone) {
  if (expression.trim().split(/\s+/).length !== 5 || !cron.validate(expression)) throw new Error('Use a valid five-field cron expression (minimum interval: one minute).');
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  const parsed = CronExpressionParser.parse(expression, { tz: timezone });
  return Array.from({ length: 5 }, () => parsed.next().toISOString());
}
export const scheduleSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(2).max(80),
  workflowId: z.string().uuid(), expression: z.string().max(100), timezone: z.string().max(80),
  enabled: z.boolean().default(true), missedPolicy: z.enum(['skip', 'latest']).default('skip'),
});
export const ruleSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(2).max(80),
  type: z.enum(['block-domain', 'max-steps', 'disable-schedules']),
  value: z.string().trim().max(200), enabled: z.boolean().default(true),
}).superRefine((rule, ctx) => {
  if (rule.type === 'max-steps' && (!/^\d+$/.test(rule.value) || +rule.value < 1 || +rule.value > 30)) ctx.addIssue({ code: 'custom', message: 'Step limit must be between 1 and 30.' });
  if (rule.type === 'block-domain' && !/^[a-z0-9.-]+$/i.test(rule.value)) ctx.addIssue({ code: 'custom', message: 'Enter a hostname, for example example.com.' });
});
export function evaluateRules(workflow, rules, scheduled = false) {
  for (const rule of rules.filter(r => r.enabled)) {
    if (rule.type === 'disable-schedules' && scheduled) return rule.name;
    if (rule.type === 'max-steps' && workflow.steps.length > +rule.value) return rule.name;
    if (rule.type === 'block-domain' && workflow.steps.some(s => s.type === 'navigate' && domainMatches(new URL(s.target).hostname, rule.value))) return rule.name;
  }
  return null;
}
export function domainMatches(host, blocked) { return host.toLowerCase() === blocked.toLowerCase() || host.toLowerCase().endsWith('.' + blocked.toLowerCase()); }
