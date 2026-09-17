import { createClient } from '@supabase/supabase-js';
export async function authorize(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url || !key) throw Object.assign(Error('Configure the admin Supabase environment first.'),{status:503});
  const origin = request.headers.get('origin');
  if(origin && new URL(origin).host !== request.headers.get('host')) throw Object.assign(Error('Origin denied.'),{status:403});
  const token = request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(!token) throw Object.assign(Error('Sign in first.'),{status:401});
  const client = createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const user = await client.auth.getUser(token);
  if(user.error || !user.data.user) throw Object.assign(Error('Session expired.'),{status:401});
  const claims = await client.auth.getClaims(token);
  if(claims.error || claims.data?.claims?.aal !== 'aal2') throw Object.assign(Error('Verify your authenticator code before opening administration.'),{status:403});
  const role = await client.rpc('is_master_admin');
  if(role.error || !role.data) throw Object.assign(Error('An active master-admin role is required.'),{status:403});
  return {client,user:user.data.user};
}
