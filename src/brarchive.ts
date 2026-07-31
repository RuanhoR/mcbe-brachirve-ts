import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { BinaryStream } from './binaryStream';

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

export interface FileEntry {
  name: string;
  offset: number;
  length: number;
  data: string;
}

export interface ArchiveFile {
  name: string;
  data: string;
}

// Removes `// line` and `/* block */` comments without touching them inside strings,
// mimicking rapidjson's kParseCommentsFlag used by the original C++ tool.
function stripJsonComments(json: string): string {
  let out = '';
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
      continue;
    }
    if (c === '/' && json[i + 1] === '*') {
      i += 2;
      while (i < json.length && !(json[i] === '*' && json[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
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

export function readArchive(input: Buffer | string): FileEntry[] {
  const buffer = typeof input === 'string' ? readFileSync(input) : input;
  const stream = new BinaryStream(buffer);

  const header = stream.readBigUInt64BE();
  if (header !== HEADER) {
    throw new Error(`Invalid archive header: 0x${header.toString(16)}`);
  }

  const count = stream.readUInt32LE();
  stream.readUInt32LE(); // version

  // The entry index comes first: name + offset + length per file.
  const files: FileEntry[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = stream.readByte();
    const name = stream.readString(NAME_MAX_LENGTH).slice(0, nameLength);
    const offset = stream.readUInt32LE();
    const length = stream.readUInt32LE();
    files.push({ name, offset, length, data: '' });
  }

  // Everything after the index is the data block.
  const content = stream.readRemaining();
  for (const file of files) {
    const raw = content.subarray(file.offset, file.offset + file.length).toString('utf8');
    const parsed = parseJson(raw);
    file.data = parsed === undefined ? raw : JSON.stringify(parsed, null, 4);
  }

  return files;
}

export function writeArchive(files: ArchiveFile[]): Buffer {
  const stream = new BinaryStream();
  stream.writeBigUInt64BE(HEADER);
  stream.writeUInt32LE(files.length);
  stream.writeUInt32LE(VERSION);

  // All entries are written first; the data block is appended afterwards,
  // so each file's offset is the running sum of previous data lengths.
  const dataChunks: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.data, 'utf8');
    stream.writeString(file.name, NAME_MAX_LENGTH);
    stream.writeUInt32LE(offset);
    stream.writeUInt32LE(data.length);
    dataChunks.push(data);
    offset += data.length;
  }

  return Buffer.concat([stream.getBuffer(), ...dataChunks]);
}

// Only `.json` files are stored (minified, comments stripped);
// anything else is stored as an empty entry, matching the original tool.
function archiveDataFor(dirPath: string, name: string): string {
  const data = readFileSync(path.join(dirPath, name), 'utf8');
  if (path.extname(name) !== '.json') return '';
  const parsed = parseJson(data);
  return parsed === undefined ? '' : JSON.stringify(parsed);
}

export function write(dirPath: string, outBase: string): string {
  const outFile = `${outBase}.brarchive`;
  const names = readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  const files = names.map((name) => ({ name, data: archiveDataFor(dirPath, name) }));
  const buffer = writeArchive(files);

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, buffer);
  return outFile;
}

function listSubdirectories(root: string): string[] {
  const dirs: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    dirs.push(full, ...listSubdirectories(full));
  }
  return dirs;
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function generate(inputDir: string): string[] {
  const stat = statSync(inputDir);
  if (!stat.isDirectory()) {
    throw new Error(`Failed to find input directory: ${inputDir}`);
  }

  // Pack every sub-directory into `<inputDir>/__brarchive/<relative>.brarchive`,
  // skipping anything that already lives under a `__brarchive` folder.
  const written: string[] = [];
  for (const dir of listSubdirectories(inputDir)) {
    const rel = toPosix(path.relative(inputDir, dir));
    if (rel.includes('__brarchive')) continue;
    const outBase = path.join(inputDir, '__brarchive', ...rel.split('/'));
    written.push(write(dir, outBase));
  }
  return written;
}

function extractSingleFile(input: string): string[] {
  const outDir = path.dirname(input);
  const written: string[] = [];
  for (const file of readArchive(input)) {
    const outFile = path.join(outDir, file.name);
    writeFileSync(outFile, file.data, 'utf8');
    written.push(outFile);
  }
  return written;
}

export function extract(input: string): string[] {
  const stat = statSync(input);
  if (stat.isFile()) {
    return extractSingleFile(input);
  }

  // Directory mode: find every `.brarchive` under `__brarchive`, derive the target
  // folder from the archive path (e.g. `__brarchive/sub/foo.brarchive` -> `sub/foo`),
  // and write each entry back next to the sources.
  const written: string[] = [];
  for (const filePath of listFiles(input)) {
    const rel = toPosix(path.relative(input, filePath));
    if (!rel.includes('__brarchive')) continue;

    const filename = rel.slice(rel.indexOf('__brarchive') + '__brarchive'.length + 1);
    if (!filename) continue;

    const dot = filename.lastIndexOf('.');
    const directory = filename.slice(0, dot === -1 ? filename.length : dot);
    const outDir = path.join(input, ...directory.split('/'));

    mkdirSync(outDir, { recursive: true });
    for (const file of readArchive(filePath)) {
      const outFile = path.join(outDir, file.name);
      writeFileSync(outFile, file.data, 'utf8');
      written.push(outFile);
    }
  }
  return written;
}
