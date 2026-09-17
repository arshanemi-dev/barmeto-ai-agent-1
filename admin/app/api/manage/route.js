import { authorize } from '../../../lib/authorize';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const {client} = await authorize(request);
    const results = await Promise.all(['applications','releases','task_rules','admin_audit_events'].map(table => client.from(table).select('*').limit(100)));
    for(const result of results) if(result.error) throw result.error;
    return Response.json({applications:results[0].data,releases:results[1].data,rules:results[2].data,audit:results[3].data.sort((a,b) => b.occurred_at.localeCompare(a.occurred_at))});
  } catch(e) { return Response.json({error:e.message},{status:e.status || 400}); }
}
export async function POST(request) {
  try {
    const {client,user} = await authorize(request);
    const raw = await request.text(); if(raw.length > 16000) throw Error('Request too large.');
    const body = JSON.parse(raw); let result;
    if(body.action === 'create-application') {
      const value = z.object({name:z.string().trim().min(2).max(80),slug:z.string().max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),description:z.string().max(300).default('')}).parse(body.value);
      result = await client.from('applications').insert({...value,owner_id:user.id});
    } else if(body.action === 'application-status') {
      const value = z.object({id:z.string().uuid(),status:z.enum(['draft','live','paused','retired'])}).parse(body.value);
      result = await client.from('applications').update({status:value.status}).eq('id',value.id);
    } else if(body.action === 'save-rule') {
      const value = z.object({name:z.string().trim().min(2).max(80),type:z.enum(['block-domain','max-steps','disable-schedules']),value:z.string().max(200)}).parse(body.value);
      if(value.type === 'max-steps' && (!/^\d+$/.test(value.value) || +value.value < 1 || +value.value > 30)) throw Error('Step limit must be 1–30.');
      if(value.type === 'block-domain' && !/^[a-z0-9.-]+$/i.test(value.value)) throw Error('Enter a valid hostname.');
      result = await client.from('task_rules').insert({name:value.name,definition:{type:value.type,value:value.value}});
    } else if(body.action === 'archive-rule') {
      const id = z.string().uuid().parse(body.value.id);
      result = await client.from('task_rules').update({archived:true,enabled:false,updated_at:new Date().toISOString()}).eq('id',id);
    } else if(body.action === 'draft-release') {
      const value = z.object({applicationId:z.string().uuid(),changeType:z.enum(['major','minor','patch']),notes:z.string().trim().min(5).max(5000)}).parse(body.value);
      result = await client.rpc('reserve_release_draft',{app_id:value.applicationId,bump:value.changeType,release_notes:value.notes});
    } else throw Error('Unknown management action.');
    if(result.error) throw result.error;
    return Response.json({ok:true,data:result.data});
  } catch(e) { return Response.json({error:e.issues?.map(i => i.message).join(' ') || e.message},{status:e.status || 400}); }
}
