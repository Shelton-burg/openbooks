import {withWorkspace} from '@/server/auth';
import {headers} from '@/server/auth';
import {snapshot, restoreCopy, recoveryState, storage} from '@/server/recovery';
import {state} from '@/server/books-state';
import {z} from 'zod';
export const dynamic = 'force-dynamic';
const json = (x: unknown, status = 200) =>
  Response.json(x, {status, headers: {'Cache-Control': 'private, no-store'}});
async function GETImpl(request: Request) {
  try {
    const uid = (await headers()).get('oai-authenticated-user-id');
    if (!uid) return json({error: 'Please sign in.'}, 401);
    const url = new URL(request.url),
      id = z.string().uuid().parse(url.searchParams.get('id')),
      s = await recoveryState(uid, id),
      fileId = url.searchParams.get('file');
    if (fileId) {
      const e = s.events.find((e) => e.kind === 'attachment' && e.payload.id === fileId);
      if (!e) return json({error: 'File not found.'}, 404);
      const object = await storage().get(e.payload.key);
      if (!object) return json({error: 'Recovery file missing.'}, 404);
      return new Response(object.body, {
        headers: {
          'Content-Type': e.payload.type,
          'Content-Disposition':
            "attachment; filename*=UTF-8''" + encodeURIComponent(e.payload.name),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    }
    return json(s);
  } catch (e) {
    return json({error: (e as Error).message}, 400);
  }
}
async function POSTImpl(request: Request) {
  try {
    const uid = (await headers()).get('oai-authenticated-user-id');
    if (!uid) return json({error: 'Please sign in.'}, 401);
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (request.headers.get('origin') &&
        request.headers.get('origin') !== new URL(process.env.APP_ORIGIN || request.url).origin)
    )
      return json({error: 'Invalid origin.'}, 403);
    const raw = await request.text();
    if (raw.length > 2000) return json({error: 'Request too large.'}, 413);
    const b = JSON.parse(raw);
    let result;
    if (b.action === 'snapshot') result = {id: await snapshot(uid)};
    else if (b.action === 'restore') result = await restoreCopy(uid, z.string().uuid().parse(b.id));
    else throw new Error('Unknown recovery action');
    return json({result, state: await state(uid)});
  } catch (e) {
    return json({error: (e as Error).message}, 400);
  }
}

export const GET = withWorkspace(GETImpl, false);

export const POST = withWorkspace(POSTImpl, true);
