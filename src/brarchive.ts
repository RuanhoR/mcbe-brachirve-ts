import { createReadStream, createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { open, readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Minecraft: Bedrock Edition `.brarchive` binary layout
 * (see https://gist.github.com/tryashtar/4e62280c1611d744b6aa5d752ab69c15):
 *
 *  - 8 bytes  : magic number (big-endian)
 *  - 4 bytes  : entry count (little-endian)
 *  - 4 bytes  : version, always 1 (little-endian)
 *  - entries  : 256 bytes each = 1-byte name length + 247-byte padded name
 *               + 4-byte offset (LE) + 4-byte length (LE)
 *  - data block: concatenated file contents; offsets are relative to its start
 */
export const HEADER = 0x7d2725b1a0527026n;
export const VERSION = 1;

// Names are stored as 1 length byte + up to 247 bytes of name.
const NAME_MAX_LENGTH = 247;

// Bounded concurrency for archive/file operations so many small files do not
// open an unbounded number of handles at once.
const CONCURRENCY = 16;

// Archives up to this size are buffered in a single read (one syscall, zero-copy
// subarrays). Larger ones are read entry-by-entry on demand to bound memory.
const READ_ALL_THRESHOLD = 16 * 1024 * 1024;

export interface FileEntry {
  name: string;
  offset: number;
  length: number;
  data: Buffer;
}

export interface ArchiveFile {
  name: string;
  data: string | Buffer;
}

/**
 * Runs `fn` over `items` with at most `limit` tasks in flight. Order of the
 * results matches the input order; workers pull the next index as they finish.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  const count = Math.min(limit, items.length);
  for (let w = 0; w < count; w++) {
    workers.push(
      (async () => {
        while (next < items.length) {
          const i = next++;
          results[i] = await fn(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// Removes `// line` and `/* block */` comments without touching them inside strings,
// mimicking rapidjson's kParseCommentsFlag used by the original C++ tool. Returns the
// input as-is when there are no comments so callers can skip a copy.
function stripJsonComments(json: string): string {
  let out = '';
  let changed = false;
  let i = 0;
  let inString = false;
  while (i < json.length) {
    const c = json[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += json[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && json[i + 1] === '/') {
      while (i < json.length && json[i] !== '\n') i += 1;
      changed = true;
      continue;
    }
    if (c === '/' && json[i + 1] === '*') {
      i += 2;
      while (i < json.length && !(json[i] === '*' && json[i + 1] === '/')) i += 1;
      i += 2;
      changed = true;
      continue;
    }
    out += c;
    i += 1;
  }
  return changed ? out : json;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch {
    // rapidjson would produce an empty document on parse failure;
    // here we just treat unparseable payloads as opaque text.
    return undefined;
  }
}

/**
 * Fast check for whether a JSON buffer needs any transformation before it can be
 * stored as-is: returns `true` when it contains comments or whitespace outside
 * strings (i.e. it is not already minified). One cheap byte scan, no JSON.parse.
 */
function needsJsonTransform(raw: Buffer): boolean {
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (c === 0x5c /* \ */) i++;
      else if (c === 0x22 /* " */) inString = false;
      continue;
    }
    if (c === 0x22) {
      inString = true;
      continue;
    }
    if (c === 0x2f /* / */) {
      const next = raw[i + 1];
      if (next === 0x2f || next === 0x2a) return true;
      continue;
    }
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) return true;
  }
  return false;
}

function minifyJsonBuffer(raw: Buffer): Buffer {
  if (!needsJsonTransform(raw)) return raw;
  const parsed = parseJson(raw.toString('utf8'));
  return parsed === undefined ? raw : Buffer.from(JSON.stringify(parsed), 'utf8');
}

async function readAll(fh: FileHandle, buffer: Buffer, position: number): Promise<void> {
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await fh.read(buffer, total, buffer.length - total, position + total);
    if (bytesRead === 0) throw new Error('Unexpected end of archive file');
    total += bytesRead;
  }
}

// Writes one chunk through a stream, applying backpressure via the write
// callback so large archives are flushed incrementally instead of all at once.
function writeChunk(ws: WriteStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

// Streams a (potentially large) binary file into the write stream without
// holding it in memory; its length was already recorded from `stat` when the
// index was built.
async function streamFileInto(ws: WriteStream, filePath: string): Promise<void> {
  for await (const chunk of createReadStream(filePath)) {
    await writeChunk(ws, chunk);
  }
}

/**
 * Writes a complete archive to `outFile`. All writes go through one stream so
 * Node batches many small entries into fewer system calls, while large binary
 * files are still piped without loading them into RAM.
 */
async function writeArchiveStream(
  outFile: string,
  header: Buffer,
  index: Buffer,
  entries: { data: Buffer | null; filePath: string }[],
): Promise<void> {
  const ws = createWriteStream(outFile);
  await new Promise<void>((resolve, reject) => {
    ws.on('error', reject);
    ws.on('finish', () => {
      ws.removeListener('error', reject);
      resolve();
    });
    (async () => {
      await writeChunk(ws, header);
      await writeChunk(ws, index);
      for (const entry of entries) {
        if (entry.data) await writeChunk(ws, entry.data);
        else await streamFileInto(ws, entry.filePath);
      }
      ws.end();
    })().catch((err) => {
      ws.destroy();
      reject(err);
    });
  });
}

function parseEntryIndex(index: Buffer, i: number): { name: string; offset: number; length: number } {
  const idx = i * 256;
  const nameLength = index[idx];
  const name = index.subarray(idx + 1, idx + 1 + NAME_MAX_LENGTH).toString('utf8').slice(0, nameLength);
  const offset = index.readUInt32LE(idx + 248);
  const length = index.readUInt32LE(idx + 252);
  return { name, offset, length };
}

function decodeEntryData(raw: Buffer): Buffer {
  const parsed = parseJson(raw.toString('utf8'));
  return parsed === undefined ? raw : Buffer.from(JSON.stringify(parsed, null, 4) ?? '', 'utf8');
}

async function readArchiveFromFile(filePath: string): Promise<FileEntry[]> {
  const { size } = await stat(filePath);
  // Typical archives are buffered with a single read (one syscall, zero-copy
  // subarrays); huge archives fall back to on-demand slice reads so the whole
  // file never has to fit in memory at once.
  if (size <= READ_ALL_THRESHOLD) {
    return readArchiveFromBuffer(await readFile(filePath));
  }

  const fh = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    await readAll(fh, header, 0);
    const magic = header.readBigUInt64BE(0);
    if (magic !== HEADER) {
      throw new Error(`Invalid archive header: 0x${magic.toString(16)}`);
    }
    const count = header.readUInt32LE(8);
    const dataStart = 16 + count * 256;

    const index = Buffer.alloc(count * 256);
    await readAll(fh, index, 16);

    const files: FileEntry[] = [];
    for (let i = 0; i < count; i++) {
      const { name, offset, length } = parseEntryIndex(index, i);
      const raw = Buffer.alloc(length);
      await readAll(fh, raw, dataStart + offset);
      files.push({ name, offset, length, data: decodeEntryData(raw) });
    }
    return files;
  } finally {
    await fh.close();
  }
}

function readArchiveFromBuffer(buffer: Buffer): FileEntry[] {
  const magic = buffer.readBigUInt64BE(0);
  if (magic !== HEADER) {
    throw new Error(`Invalid archive header: 0x${magic.toString(16)}`);
  }
  const count = buffer.readUInt32LE(8);
  const dataStart = 16 + count * 256;
  const index = buffer.subarray(16, dataStart);

  const files: FileEntry[] = [];
  for (let i = 0; i < count; i++) {
    const { name, offset, length } = parseEntryIndex(index, i);
    // subarray shares the source buffer: zero-copy for non-JSON payloads.
    const raw = buffer.subarray(dataStart + offset, dataStart + offset + length);
    files.push({ name, offset, length, data: decodeEntryData(raw) });
  }
  return files;
}

export async function readArchive(input: Buffer | string): Promise<FileEntry[]> {
  return typeof input === 'string' ? readArchiveFromFile(input) : readArchiveFromBuffer(input);
}

export async function writeArchive(files: ArchiveFile[]): Promise<Buffer> {
  // Allocate the final buffer once and copy each payload into it, avoiding the
  // intermediate per-file chunks + Buffer.concat duplication of the old code.
  const names: Buffer[] = [];
  const datas: Buffer[] = [];
  let total = 0;
  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    names.push(Buffer.from(file.name, 'utf8'));
    datas.push(data);
    total += data.length;
  }

  const dataStart = 16 + files.length * 256;
  const out = Buffer.alloc(dataStart + total);
  out.writeBigUInt64BE(HEADER, 0);
  out.writeUInt32LE(files.length, 8);
  out.writeUInt32LE(VERSION, 12);

  let offset = 0;
  for (let i = 0; i < files.length; i++) {
    const name = names[i];
    const n = Math.min(name.length, NAME_MAX_LENGTH);
    const idx = 16 + i * 256;
    out.writeUInt8(n, idx);
    name.copy(out, idx + 1, 0, n);
    out.writeUInt32LE(offset, idx + 248);
    out.writeUInt32LE(datas[i].length, idx + 252);
    datas[i].copy(out, dataStart + offset);
    offset += datas[i].length;
  }
  return out;
}

/**
 * Streams one directory into `<outBase>.brarchive` on disk. Files are read and
 * processed concurrently; JSON is minified once (parse/stringify only when
 * comments or whitespace exist), binary files are copied through a stream so
 * their bytes never have to fit in RAM.
 */
async function archiveDirFiles(dirPath: string, names: string[], outFile: string): Promise<void> {
  const entries = await mapLimit(names, CONCURRENCY, async (name) => {
    const filePath = path.join(dirPath, name);
    if (path.extname(name) === '.json') {
      const data = minifyJsonBuffer(await readFile(filePath));
      return { name, data, length: data.length, filePath };
    }
    const { size } = await stat(filePath);
    return { name, data: null, length: size, filePath };
  });

  const index = Buffer.alloc(entries.length * 256);
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const name = Buffer.from(entries[i].name, 'utf8');
    const n = Math.min(name.length, NAME_MAX_LENGTH);
    const idx = i * 256;
    index.writeUInt8(n, idx);
    name.copy(index, idx + 1, 0, n);
    index.writeUInt32LE(offset, idx + 248);
    index.writeUInt32LE(entries[i].length, idx + 252);
    offset += entries[i].length;
  }

  const header = Buffer.alloc(16);
  header.writeBigUInt64BE(HEADER, 0);
  header.writeUInt32LE(entries.length, 8);
  header.writeUInt32LE(VERSION, 12);

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeArchiveStream(outFile, header, index, entries);
}

export async function write(dirPath: string, outBase: string): Promise<string> {
  const outFile = `${outBase}.brarchive`;
  const entries = await readdir(dirPath, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  await archiveDirFiles(dirPath, names, outFile);
  return outFile;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Single recursive traversal that returns every sub-directory of `root` together
 * with its immediate file names. Directories under `__brarchive` are skipped.
 */
async function collectDirs(root: string): Promise<{ dir: string; files: string[] }[]> {
  const results: { dir: string; files: string[] }[] = [];

  async function visit(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.isFile()) files.push(entry.name);
      else if (entry.isDirectory()) dirs.push(entry.name);
    }
    files.sort((a, b) => a.localeCompare(b));
    dirs.sort((a, b) => a.localeCompare(b));

    for (const name of dirs) {
      const child = path.join(dir, name);
      if (toPosix(path.relative(root, child)).includes('__brarchive')) continue;
      const childFiles = await visit(child);
      results.push({ dir: child, files: childFiles });
    }
    return files;
  }

  await visit(root);
  return results;
}

export async function generate(inputDir: string): Promise<string[]> {
  const st = await stat(inputDir);
  if (!st.isDirectory()) {
    throw new Error(`Failed to find input directory: ${inputDir}`);
  }

  // Pack every sub-directory into `<inputDir>/__brarchive/<relative>.brarchive`.
  // Directories are processed concurrently; results are returned sorted.
  const dirs = await collectDirs(inputDir);
  const written = await mapLimit(dirs, CONCURRENCY, async ({ dir, files }) => {
    const rel = toPosix(path.relative(inputDir, dir));
    const outBase = path.join(inputDir, '__brarchive', ...rel.split('/'));
    const outFile = `${outBase}.brarchive`;
    await archiveDirFiles(dir, files, outFile);
    return outFile;
  });
  return written.sort((a, b) => a.localeCompare(b));
}

async function extractSingleFile(input: string): Promise<string[]> {
  const outDir = path.dirname(input);
  const files = await readArchive(input);
  // Writes are issued concurrently (bounded) so I/O overlaps; result order is
  // preserved by mapLimit.
  return mapLimit(files, CONCURRENCY, async (file) => {
    const outFile = path.join(outDir, file.name);
    await writeFile(outFile, file.data);
    return outFile;
  });
}

/** Collects every file under a `__brarchive` directory (single traversal). */
async function collectBrarchives(root: string): Promise<string[]> {
  const archives: string[] = [];
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) archives.push(full);
    }
  }
  await visit(root);
  return archives;
}

export async function extract(input: string): Promise<string[]> {
  const st = await stat(input);
  if (st.isFile()) {
    return extractSingleFile(input);
  }

  // Directory mode: find every `.brarchive` under `__brarchive`, derive the target
  // folder from the archive path (e.g. `__brarchive/sub/foo.brarchive` -> `sub/foo`),
  // and write each entry back next to the sources. Archives are processed
  // concurrently; each one is read with on-demand slices to bound memory.
  const archives = await collectBrarchives(input);
  const groups = await mapLimit(archives, CONCURRENCY, async (filePath) => {
    const rel = toPosix(path.relative(input, filePath));
    if (!rel.includes('__brarchive')) return [];

    const filename = rel.slice(rel.indexOf('__brarchive') + '__brarchive'.length + 1);
    if (!filename) return [];

    const dot = filename.lastIndexOf('.');
    const directory = filename.slice(0, dot === -1 ? filename.length : dot);
    const outDir = path.join(input, ...directory.split('/'));
    await mkdir(outDir, { recursive: true });

    const files = await readArchive(filePath);
    // Write entries concurrently; mapLimit preserves the file order.
    return mapLimit(files, CONCURRENCY, async (file) => {
      const outFile = path.join(outDir, file.name);
      await writeFile(outFile, file.data);
      return outFile;
    });
  });

  return groups.flat().sort((a, b) => a.localeCompare(b));
}
