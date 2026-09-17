import { runtimeRequest } from '../../../lib/api.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) { return runtimeRequest(request, '/state'); }
export async function POST(request) {
  if (Number(request.headers.get('content-length') || 0) > 128000) return Response.json({ error: 'Request too large.' }, { status: 413 });
  try { return runtimeRequest(request, '/action', await request.json()); }
  catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
}
