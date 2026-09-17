import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowSchema, previewSchedule, evaluateRules, domainMatches } from '../lib/contracts.mjs';
const workflow = { name:'Report',description:'',allowedOrigins:['https://example.com'],steps:[{ id:'1',type:'navigate',target:'https://example.com',value:'' }] };
test('workflow restricts navigation to approved HTTP origins', () => {
  assert.ok(workflowSchema.safeParse(workflow).success);
  assert.equal(workflowSchema.safeParse({ ...workflow,steps:[{ ...workflow.steps[0],target:'https://evil.example' }] }).success,false);
  assert.equal(workflowSchema.safeParse({ ...workflow,allowedOrigins:['file:///private'],steps:[{ ...workflow.steps[0],target:'file:///private' }] }).success,false);
});
test('duplicate step IDs and unbounded waits are rejected', () => {
  assert.equal(workflowSchema.safeParse({ ...workflow,steps:[...workflow.steps,...workflow.steps] }).success,false);
  assert.equal(workflowSchema.safeParse({ ...workflow,steps:[{ id:'1',type:'wait',value:'999999' }] }).success,false);
});
test('schedule validation rejects seconds and invalid timezones', () => {
  assert.throws(() => previewSchedule('* * * * * *','Asia/Kolkata'));
  assert.throws(() => previewSchedule('0 9 * * *','Not/AZone'));
  const dates = previewSchedule('0 9 * * *','Asia/Kolkata');
  assert.equal(dates.length,5);
  assert.ok(dates.every(d => d.includes('T03:30:00')));
  assert.ok(dates[1] > dates[0]);
});
test('domain denials cover subdomains without matching lookalikes', () => {
  assert.equal(domainMatches('www.example.com','example.com'),true);
  assert.equal(domainMatches('notexample.com','example.com'),false);
  const rule = { name:'Restricted domain',type:'block-domain',value:'example.com',enabled:true };
  assert.equal(evaluateRules(workflow,[rule]),'Restricted domain');
  assert.equal(evaluateRules(workflow,[{ ...rule,enabled:false }]),null);
});
test('schedule prohibition does not prohibit manual runs', () => {
  const rules = [{ name:'Pause schedules',type:'disable-schedules',enabled:true }];
  assert.equal(evaluateRules(workflow,rules,false),null);
  assert.equal(evaluateRules(workflow,rules,true),'Pause schedules');
});
