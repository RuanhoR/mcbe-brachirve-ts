import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HEADER, VERSION, extract, generate, readArchive, write, writeArchive } from '../../src/brarchive';

const tempDirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'brarchive-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('constants', () => {
  it('HEADER is the Bedrock magic number', () => {
    expect(HEADER).toBe(0x7d2725b1a0527026n);
  });

  it('VERSION is 1', () => {
    expect(VERSION).toBe(1);
  });
});

describe('writeArchive', () => {
  it('writes the magic, count and version header', () => {
    const buf = writeArchive([{ name: 'a.json', data: '{}' }]);
    expect(buf.readBigUInt64BE(0)).toBe(HEADER);
    expect(buf.readUInt32LE(8)).toBe(1);
    expect(buf.readUInt32LE(12)).toBe(VERSION);
  });

  it('stores one 256-byte entry per file', () => {
    const buf = writeArchive([{ name: 'a.json', data: '{"a":1}' }]);
    expect(buf.length).toBe(16 + 256 + 7);
    expect(buf[16]).toBe(6);
    expect(buf.readUInt32LE(16 + 248)).toBe(0);
    expect(buf.readUInt32LE(16 + 252)).toBe(7);
  });

  it('accumulates data offsets across multiple files', () => {
    const buf = writeArchive([
      { name: 'a.json', data: '{"a":1}' },
      { name: 'b.json', data: '{"bb":2}' },
    ]);
    expect(buf.readUInt32LE(16 + 256 + 248)).toBe(7);
    expect(buf.readUInt32LE(16 + 256 + 252)).toBe(8);
  });

  it('measures data length in UTF-8 bytes', () => {
    const data = '{"name":"测试"}';
    const buf = writeArchive([{ name: 'a.json', data }]);
    expect(buf.readUInt32LE(16 + 252)).toBe(Buffer.byteLength(data, 'utf8'));
  });

  it('round-trips through readArchive', () => {
    const buf = writeArchive([{ name: 'a.json', data: '{"a":1}' }]);
    const files = readArchive(buf);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('a.json');
    expect(files[0].data.toString('utf8')).toBe('{\n    "a": 1\n}');
  });
});

describe('readArchive', () => {
  it('pretty-prints JSON with a 4-space indent', () => {
    const buf = writeArchive([{ name: 'a.json', data: '{"x":[1,2]}' }]);
    expect(readArchive(buf)[0].data.toString('utf8')).toBe('{\n    "x": [\n        1,\n        2\n    ]\n}');
  });

  it('throws on an invalid header', () => {
    expect(() => readArchive(Buffer.from('not-an-archive!'))).toThrow(/Invalid archive header/);
  });

  it('preserves non-JSON payloads verbatim', () => {
    const buf = writeArchive([{ name: 'a.bin', data: 'hello world' }]);
    expect(readArchive(buf)[0].data.toString('utf8')).toBe('hello world');
  });
});

describe('generate / extract', () => {
  it('generates one archive per sub-directory and skips __brarchive', () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    mkdirSync(join(root, 'a', 'b'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');
    writeFileSync(join(root, 'a', 'b', 'y.json'), '{"y":2}');

    const written = generate(root);
    expect(written).toContain(join(root, '__brarchive', 'a.brarchive'));
    expect(written).toContain(join(root, '__brarchive', 'a', 'b.brarchive'));
    expect(written.every((p) => p.endsWith('.brarchive'))).toBe(true);
  });

  it('strips JSON comments when generating', () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{\n  // note\n  "x": 1 /* block */\n}\n');

    generate(root);
    const files = readArchive(join(root, '__brarchive', 'a.brarchive'));
    expect(files).toHaveLength(1);
    expect(files[0].data.toString('utf8')).toBe('{\n    "x": 1\n}');
  });

  it('preserves non-JSON files verbatim when generating', () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    writeFileSync(join(root, 'a', 'icon.png'), png);

    generate(root);
    const files = readArchive(join(root, '__brarchive', 'a.brarchive'));
    const icon = files.find((file) => file.name === 'icon.png');
    expect(icon?.length).toBe(png.length);
    expect(icon?.data).toEqual(png);
  });

  it('round-trips binary files through generate then extract', () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    writeFileSync(join(root, 'a', 'icon.png'), png);

    generate(root);
    extract(root);
    expect(readFileSync(join(root, 'a', 'icon.png'))).toEqual(png);
  });

  it('write() emits <out>.brarchive', () => {
    const root = makeDir();
    const sub = join(root, 'a');
    mkdirSync(sub);
    writeFileSync(join(sub, 'x.json'), '{"x":1}');

    const outFile = write(sub, join(root, 'pack'));
    expect(outFile).toBe(join(root, 'pack.brarchive'));
    expect(readFileSync(outFile).readBigUInt64BE(0)).toBe(HEADER);
  });

  it('extracts a single archive file next to itself', () => {
    const root = makeDir();
    const sub = join(root, 'a');
    mkdirSync(sub);
    writeFileSync(join(sub, 'x.json'), '{"x":1}');
    write(sub, join(root, '__out'));

    const extracted = extract(join(root, '__out.brarchive'));
    expect(extracted).toEqual([join(root, 'x.json')]);
    expect(readFileSync(join(root, 'x.json'), 'utf8')).toBe('{\n    "x": 1\n}');
  });

  it('extracts a whole directory back to its folders', () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');
    generate(root);

    const extracted = extract(root);
    expect(extracted).toContain(join(root, 'a', 'x.json'));
    expect(JSON.parse(readFileSync(join(root, 'a', 'x.json'), 'utf8'))).toEqual({ x: 1 });
  });

  it('round-trips JSON contents through generate then extract', () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    const original = { x: [1, 2, 3], name: '测试' };
    writeFileSync(join(root, 'a', 'x.json'), JSON.stringify(original));

    generate(root);
    extract(root);

    expect(JSON.parse(readFileSync(join(root, 'a', 'x.json'), 'utf8'))).toEqual(original);
  });
});
