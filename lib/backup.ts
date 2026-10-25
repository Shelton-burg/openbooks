import {derive, report, balanced, settingsSchema, type State} from './books.ts';
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({length: 256}, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function sha256(data: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function financialSummary(state: State) {
  const v = derive(state.events),
    r = report(state.events, '0001-01-01', '9999-12-31', state.settings.gstBasis);
  if (v.journal.some((j) => !balanced(j.lines)))
    throw new Error('A saved journal does not balance.');
  return {
    events: state.events.length,
    documents: v.docs.length,
    bankLines: v.banks.length,
    attachments: state.events.filter((e) => e.kind === 'attachment').length,
    credits: v.credits.length,
    customerFunds: v.funds.length,
    trial: r.trial.map((a) => ({code: a.code, balance: a.balance})),
    outstandingInvoices: v.docs
      .filter((d) => d.type === 'invoice' && d.status === 'open')
      .reduce((n, d) => n + d.balance, 0),
    outstandingBills: v.docs
      .filter((d) => d.type === 'bill' && d.status === 'open')
      .reduce((n, d) => n + d.balance, 0),
  };
}
export type ArchiveFile = {name: string; data: Uint8Array};
// Uncompressed ZIP entries allow streaming with bounded memory and ordinary ZIP readers.
export async function* zipStore(files: AsyncIterable<ArchiveFile>) {
  const central: {name: Uint8Array; size: number; crc: number; offset: number}[] = [];
  let offset = 0;
  for await (const f of files) {
    const name = encoder.encode(f.name),
      crc = crc32(f.data),
      header = new Uint8Array(30 + name.length),
      v = new DataView(header.buffer);
    if (
      f.data.length > 16000000 ||
      name.length > 65535 ||
      central.length >= 5000 ||
      offset + header.length + f.data.length > 500000000
    )
      throw new Error('Backup exceeds the supported archive limit.');
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, f.data.length, true);
    v.setUint32(22, f.data.length, true);
    v.setUint16(26, name.length, true);
    header.set(name, 30);
    central.push({name, size: f.data.length, crc, offset});
    offset += header.length + f.data.length;
    yield header;
    yield f.data;
  }
  const start = offset;
  for (const f of central) {
    const h = new Uint8Array(46 + f.name.length),
      v = new DataView(h.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0x800, true);
    v.setUint32(16, f.crc, true);
    v.setUint32(20, f.size, true);
    v.setUint32(24, f.size, true);
    v.setUint16(28, f.name.length, true);
    v.setUint32(42, f.offset, true);
    h.set(f.name, 46);
    offset += h.length;
    yield h;
  }
  const end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, offset - start, true);
  v.setUint32(16, start, true);
  yield end;
}
export async function zipEntries(file: Blob) {
  if (file.size > 500000000) throw new Error('Choose an OpenBooks backup up to 500 MB.');
  const entries: {
    name: string;
    offset: number;
    headerOffset: number;
    size: number;
    crc: number;
  }[] = [];
  let pos = 0;
  const names = new Set<string>();
  while (pos + 4 <= file.size) {
    const data = await file.slice(pos, pos + 30).arrayBuffer(),
      v = new DataView(data),
      magic = v.getUint32(0, true);
    if (magic === 0x02014b50) break;
    if (magic !== 0x04034b50 || data.byteLength < 30) throw new Error('Invalid ZIP archive.');
    const flags = v.getUint16(6, true),
      method = v.getUint16(8, true),
      size = v.getUint32(18, true),
      plain = v.getUint32(22, true),
      length = v.getUint16(26, true),
      extra = v.getUint16(28, true);
    if (
      method !== 0 ||
      (flags & 9) !== 0 ||
      size !== plain ||
      size > 16000000 ||
      entries.length >= 5000
    )
      throw new Error('Use an original, uncompressed OpenBooks backup.');
    const name = new TextDecoder().decode(
      await file.slice(pos + 30, pos + 30 + length).arrayBuffer(),
    );
    if (
      !name ||
      names.has(name) ||
      name.split('/').some((part) => part === '..' || part === '') ||
      name.startsWith('/') ||
      name.includes('\\')
    )
      throw new Error('Invalid or repeated archive filename.');
    const offset = pos + 30 + length + extra;
    if (offset + size > file.size) throw new Error('The archive is incomplete.');
    entries.push({name, offset, headerOffset: pos, size, crc: v.getUint32(14, true)});
    names.add(name);
    pos = offset + size;
  }
  // The end-of-directory record detects truncated downloads after the last file.
  if (file.size < 22) throw new Error('Incomplete archive.');
  const end = new DataView(await file.slice(file.size - 22).arrayBuffer());
  if (
    end.getUint32(0, true) !== 0x06054b50 ||
    end.getUint16(10, true) !== entries.length ||
    end.getUint32(16, true) !== pos
  )
    throw new Error('The archive directory is incomplete.');
  let cursor = pos;
  for (const e of entries) {
    const raw = await file.slice(cursor, cursor + 46).arrayBuffer();
    if (raw.byteLength !== 46) throw new Error('Incomplete archive directory.');
    const d = new DataView(raw);
    if (
      d.getUint32(0, true) !== 0x02014b50 ||
      d.getUint16(10, true) !== 0 ||
      d.getUint32(16, true) !== e.crc ||
      d.getUint32(20, true) !== e.size ||
      d.getUint32(24, true) !== e.size ||
      d.getUint32(42, true) !== e.headerOffset
    )
      throw new Error('Archive directory does not match its files.');
    const length = d.getUint16(28, true),
      name = new TextDecoder().decode(
        await file.slice(cursor + 46, cursor + 46 + length).arrayBuffer(),
      );
    if (name !== e.name) throw new Error('Archive filenames do not match.');
    cursor += 46 + length + d.getUint16(30, true) + d.getUint16(32, true);
  }
  if (cursor !== file.size - 22 || end.getUint32(12, true) !== cursor - pos)
    throw new Error('Archive directory size is invalid.');
  return entries;
}
export async function verifyBackup(file: Blob, onProgress?: (message: string) => void) {
  const entries = await zipEntries(file),
    manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) throw new Error('The backup manifest is missing.');
  const read = async (e: (typeof entries)[number]) => {
    const bytes = new Uint8Array(await file.slice(e.offset, e.offset + e.size).arrayBuffer());
    if (crc32(bytes) !== e.crc) throw new Error('File checksum failed: ' + e.name);
    return bytes;
  };
  const manifest = JSON.parse(new TextDecoder().decode(await read(manifestEntry)));
  if (
    manifest.format !== 'tradedesk-books-backup' ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== entries.length - 1
  )
    throw new Error('Unsupported or incomplete backup manifest.');
  const listed = new Set();
  let books: State | undefined;
  for (const [i, m] of manifest.files.entries()) {
    if (typeof m.name !== 'string' || listed.has(m.name))
      throw new Error('Invalid manifest entries.');
    listed.add(m.name);
    const e = entries.find((e) => e.name === m.name);
    if (!e || e.size !== m.size) throw new Error('File missing or size changed: ' + m.name);
    onProgress?.('Checking ' + (i + 1) + ' of ' + manifest.files.length + ' files');
    const bytes = await read(e);
    if ((await sha256(bytes)) !== m.sha256) throw new Error('Integrity check failed: ' + m.name);
    if (m.name === 'books.json') {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      settingsSchema.parse(parsed.settings);
      if (!Array.isArray(parsed.events) || parsed.events.length > 100000)
        throw new Error('Invalid books file.');
      books = parsed;
    }
  }
  if (!books) throw new Error('The books file is missing.');
  const summary = financialSummary(books);
  if (JSON.stringify(summary) !== JSON.stringify(manifest.summary))
    throw new Error('Reconstructed balances differ from the saved manifest.');
  for (const e of books.events.filter((e) => e.kind === 'attachment'))
    if (!listed.has(e.payload.backupPath))
      throw new Error('An attachment is missing from this backup.');
  return {
    createdAt: manifest.createdAt,
    summary,
    business: books.settings.name,
    files: entries.length,
    notice:
      'Integrity and reconstructed balances checked. This is not a live restore or independent proof that the source books are complete.',
  };
}
