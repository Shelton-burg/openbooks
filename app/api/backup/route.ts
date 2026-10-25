import {withWorkspace} from '@/server/auth';
import {headers} from '@/server/auth';
import {env} from '@/server/storage';
import {GET as getBooks} from '../books/route';
import {financialSummary, sha256, zipStore, type ArchiveFile} from '@/lib/backup';
import {today, type State} from '@/lib/books';
export const dynamic = 'force-dynamic';
async function GETImpl(request: Request) {
  if (!(await headers()).get('oai-authenticated-user-id'))
    return Response.json({error: 'Please sign in.'}, {status: 401});
  const response = await getBooks(request);
  if (!response.ok) return response;
  const state = (await response.json()) as State,
    createdAt = new Date().toISOString(),
    attachments = state.events.filter((e) => e.kind === 'attachment'),
    storage = (env as unknown as {BUCKET: R2Bucket}).BUCKET;
  if (attachments.reduce((n, e) => n + e.payload.size, 0) > 480000000 || attachments.length > 4995)
    return Response.json(
      {error: 'This archive is too large for one download. A partitioned backup is required.'},
      {status: 413},
    );
  const summary = financialSummary(state),
    portable = {
      ...state,
      events: state.events.map((e) =>
        e.kind === 'attachment'
          ? {
              ...e,
              payload: {
                ...e.payload,
                key: undefined,
                backupPath:
                  'attachments/' +
                  e.payload.id +
                  '-' +
                  e.payload.name.replace(/[^a-zA-Z0-9._-]/g, '_'),
              },
            }
          : e,
      ),
    },
    bookBytes = new TextEncoder().encode(JSON.stringify(portable));
  if (bookBytes.length > 12000000)
    return Response.json({error: 'The event history needs a partitioned backup.'}, {status: 413});
  async function* files(): AsyncGenerator<ArchiveFile> {
    const manifest: {name: string; size: number; sha256: string}[] = [];
    const add = async (name: string, data: Uint8Array) => {
      manifest.push({name, size: data.length, sha256: await sha256(data)});
      return {name, data};
    };
    yield await add('books.json', bookBytes);
    for (const e of attachments) {
      const object = await storage.get(e.payload.key);
      if (!object || object.size !== e.payload.size)
        throw new Error('An attachment could not be read; this backup is incomplete.');
      const bytes = new Uint8Array(await object.arrayBuffer()),
        entry = portable.events.find((x) => x.id === e.id)!;
      yield await add(entry.payload.backupPath, bytes);
    }
    yield {
      name: 'manifest.json',
      data: new TextEncoder().encode(
        JSON.stringify({
          format: 'tradedesk-books-backup',
          version: 1,
          createdAt,
          files: manifest,
          summary,
          scope:
            'Records, settings and original attachments. Verify this archive before relying on it; automatic restore is not yet enabled.',
        }),
      ),
    };
  }
  const iterator = zipStore(files()),
    stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const r = await iterator.next();
          if (r.done) controller.close();
          else controller.enqueue(r.value);
        } catch (e) {
          console.error('Backup download failed', (e as Error).message);
          controller.error(new Error('Incomplete backup. Try again.'));
        }
      },
      async cancel() {
        await iterator.return(undefined);
      },
    });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="tradedesk-backup-' + today() + '.zip"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const GET = withWorkspace(GETImpl, false);
