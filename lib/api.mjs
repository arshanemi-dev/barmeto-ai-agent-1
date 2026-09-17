import { timingSafeEqual } from 'node:crypto';
export function authorize(request) {
  if (process.env.BARMETO_DESKTOP === '1') {
    const a = Buffer.from(request.headers.get('x-barmeto-token') || '');
    const b = Buffer.from(process.env.BARMETO_LOCAL_TOKEN || '');
    if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) throw Error('Unauthorized desktop request.');
  } else {
    if (process.env.NODE_ENV === 'production') throw Error('Start the production application through Electron.');
    if (request.headers.get('x-barmeto-client') !== 'workspace') throw Error('Unauthorized local request.');
  }
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) throw Error('Origin is not allowed.');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw Error('Cross-site requests are not allowed.');
}
export async function runtimeRequest(request, endpoint, body) {
  try { authorize(request); } catch (e) { return Response.json({ error: e.message }, { status: 403 }); }
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.BARMETO_SERVICE_PORT || 4318}${endpoint}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${process.env.BARMETO_SERVICE_TOKEN}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    return Response.json(await response.json(), { status: response.status });
  } catch { return Response.json({ error: 'Local runtime is unavailable. Start the app using npm run dev or npm run dev:web.' }, { status: 503 }); }
}
