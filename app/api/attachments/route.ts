import {withWorkspace} from '@/server/auth';
import {headers} from '@/server/auth';
import {env} from '@/server/storage';
import {z} from 'zod';
import {db} from '@/db';
import {derive, type Event} from '@/lib/books';
import {GET as getBooks} from '../books/route';
import {sha256} from '@/lib/backup';
import {attachments} from '@/lib/reliability';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) =>
  Response.json(data, {status, headers: {'Cache-Control': 'private, no-store'}});
async function owner() {
  const uid = (await headers()).get('oai-authenticated-user-id');
  if (!uid) throw new Error('SIGN_IN');
  return uid;
}
function bucket() {
  const storage = (env as unknown as {BUCKET?: R2Bucket}).BUCKET;
  if (!storage) throw new Error('File storage is unavailable. Please try again shortly.');
  return storage;
}
async function GETImpl(request: Request) {
  try {
    const uid = await owner(),
      id = z.string().uuid().parse(new URL(request.url).searchParams.get('id'));
    const row = await db()
      .prepare('SELECT payload FROM book_events WHERE owner=? AND event_key=?')
      .bind(uid, 'attachment:' + id)
      .first<{payload: string}>();
    if (!row) return json({error: 'File not found.'}, 404);
    const metadata = JSON.parse(row.payload),
      file = await bucket().get(metadata.key);
    if (!file) return json({error: 'File temporarily unavailable.'}, 404);
    return new Response(file.body, {
      headers: {
        'Content-Type': metadata.type,
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(metadata.name),
        'Content-Length': String(file.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return json(
      {
        error:
          (e as Error).message === 'SIGN_IN'
            ? 'Please sign in.'
            : 'Unable to download this attachment.',
      },
      (e as Error).message === 'SIGN_IN' ? 401 : 400,
    );
  }
}
async function POSTImpl(request: Request) {
  let objectKey: string | undefined;
  try {
    const uid = await owner(),
      origin = request.headers.get('origin');
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== new URL(process.env.APP_ORIGIN || request.url).origin)
    )
      return json({error: 'Invalid request origin.'}, 403);
    if (!request.headers.get('content-type')?.includes('multipart/form-data'))
      return json({error: 'Choose a file to upload.'}, 415);
    const declared = Number(request.headers.get('content-length'));
    if (declared > 8500000) return json({error: 'Attachments must be 8 MB or smaller.'}, 413);
    // Bound the request before parsing multipart data to keep uploads within Worker memory limits.
    const reader = request.body?.getReader();
    if (!reader) return json({error: 'File required.'}, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8500000) {
        await reader.cancel();
        return json({error: 'Attachments must be 8 MB or smaller.'}, 413);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const form = await new Request(request.url, {
        method: 'POST',
        headers: {'Content-Type': request.headers.get('content-type')!},
        body: bytes,
      }).formData(),
      id = z.string().uuid().parse(form.get('id')),
      target = z.string().min(1).max(100).parse(form.get('target')),
      revision = z.string().min(1).parse(form.get('revision')),
      file = form.get('file');
    if (!file || typeof file === 'string' || file.size === 0 || file.size > 8000000)
      return json({error: 'Choose a PDF, JPEG, PNG or WebP file up to 8 MB.'}, 400);
    const records = await db()
      .prepare('SELECT id,kind,payload,created_at FROM book_events WHERE owner=? ORDER BY seq ASC')
      .bind(uid)
      .all();
    const events: Event[] = records.results.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      payload: JSON.parse(r.payload),
      createdAt: r.created_at,
    }));
    if (events.some((e) => e.kind === 'attachment' && e.payload.id === id))
      return getBooks(request);
    if ((events.at(-1)?.id || 'empty') !== revision)
      return json({error: 'Your books changed. Refresh the records, then upload again.'}, 409);
    const v = derive(events);
    if (
      !['inbox', 'import_inbox'].includes(target) &&
      !v.docs.some((d) => d.id === target) &&
      !v.banks.some((b) => b.id === target) &&
      !v.credits.some((c) => c.id === target) &&
      !v.funds.some((f) => f.id === target)
    )
      return json({error: 'Record not found.'}, 404);
    const data = await file.arrayBuffer(),
      signature = new Uint8Array(data),
      text = new TextDecoder('latin1').decode(signature.slice(0, 12));
    let type = '';
    if (text.startsWith('%PDF-')) type = 'application/pdf';
    else if (signature[0] === 255 && signature[1] === 216 && signature[2] === 255)
      type = 'image/jpeg';
    else if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => signature[i] === n))
      type = 'image/png';
    else if (text.startsWith('RIFF') && text.slice(8) === 'WEBP') type = 'image/webp';
    if (!type && target === 'import_inbox' && /\.csv$/i.test(file.name) && file.size <= 2000000) {
      try {
        const content = new TextDecoder('utf-8', {fatal: true}).decode(signature);
        if (!content.includes('\0')) type = 'text/csv';
      } catch {}
    }
    if (!type)
      return json(
        {
          error:
            target === 'import_inbox'
              ? 'Use PDF, PNG, JPEG or WebP up to 8 MB, or a UTF-8 CSV up to 2 MB.'
              : 'Only valid PDF, JPEG, PNG or WebP files are accepted.',
        },
        400,
      );
    const digest = await sha256(signature),
      duplicate = attachments(events).find((e) => e.payload.sha256 === digest);
    if (duplicate) {
      if (target === 'import_inbox' && duplicate.payload.target === 'inbox')
        return json(
          {
            error:
              'This file is already saved in the bill receipt inbox. Open New bill and choose the saved receipt to continue.',
            existingTarget: 'inbox',
          },
          409,
        );
      if (duplicate.payload.target !== 'inbox' && duplicate.payload.target !== target)
        return json(
          {
            error:
              'This receipt is already attached to another record. Open that record to avoid a duplicate bill.',
            existingTarget: duplicate.payload.target,
          },
          409,
        );
      return getBooks(request);
    }
    const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 180) || 'attachment';
    objectKey = 'attachments/' + encodeURIComponent(uid) + '/' + crypto.randomUUID();
    await bucket().put(objectKey, data, {httpMetadata: {contentType: type}});
    const createdAt = new Date().toISOString(),
      payload = {id, target, name, type, size: file.size, key: objectKey, sha256: digest};
    await db().batch([
      db()
        .prepare(
          'INSERT INTO book_events (id,owner,event_key,kind,payload,created_at) VALUES (?,?,?,?,?,?)',
        )
        .bind(crypto.randomUUID(), uid, 'revision:' + revision, 'write_guard', '{}', createdAt),
      db()
        .prepare(
          'INSERT INTO book_events (id,owner,event_key,kind,payload,created_at) VALUES (?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          uid,
          'attachment:' + id,
          'attachment',
          JSON.stringify(payload),
          createdAt,
        ),
    ]);
    objectKey = undefined;
    return getBooks(request);
  } catch (e) {
    if (objectKey) {
      try {
        await bucket().delete(objectKey);
      } catch {
        console.error('Attachment cleanup failed');
      }
    }
    const m = (e as Error).message;
    if (m === 'SIGN_IN') return json({error: 'Please sign in.'}, 401);
    console.error('Attachment upload failed', m);
    return json(
      {
        error: m.includes('UNIQUE')
          ? 'Your books changed during upload. Refresh and try again.'
          : 'Attachment was not saved. Check the file and try again.',
      },
      m.includes('UNIQUE') ? 409 : 400,
    );
  }
}

export const GET = withWorkspace(GETImpl, false);

export const POST = withWorkspace(POSTImpl, true);
