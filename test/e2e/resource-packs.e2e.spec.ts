import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extract, generate, readArchive } from '../../src/index';

const FIXTURE = join(process.cwd(), 'test', 'e2e', 'fixtures', 'resource_packs');

let workDir = '';
let packDir = '';

function listFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function subdirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'brarchive-e2e-'));
  packDir = join(workDir, 'resource_packs');
  cpSync(FIXTURE, packDir, { recursive: true });
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('real resource pack e2e', () => {
  it('uses an unpacked fixture with archives and sources', () => {
    expect(existsSync(packDir)).toBe(true);
    expect(listFiles(packDir).length).toBeGreaterThan(0);
    expect(existsSync(join(packDir, '__brarchive'))).toBe(true);
  });

  it('reads the original .brarchive files shipped with the pack', () => {
    const archives = listFiles(join(packDir, '__brarchive')).filter((p) =>
      p.endsWith('.brarchive'),
    );
    expect(archives.length).toBeGreaterThan(0);

    for (const archive of archives) {
      const files = readArchive(archive);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(typeof file.name).toBe('string');
        expect(file.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('packs every sub-directory into __brarchive once', () => {
    const dirs = subdirectories(packDir).filter((name) => name !== '__brarchive');
    expect(dirs.length).toBeGreaterThan(0);

    const written = generate(packDir);
    for (const dir of dirs) {
      expect(written).toContain(join(packDir, '__brarchive', `${dir}.brarchive`));
    }
    for (const archive of written) {
      expect(readArchive(archive).length).toBeGreaterThan(0);
    }
  });

  it('unpacks the archive back to files and round-trips every JSON', () => {
    const before = new Map<string, unknown>();
    for (const file of listFiles(packDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        before.set(file, JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        // skip files that are not parseable JSON
      }
    }
    expect(before.size).toBeGreaterThan(0);

    const extracted = extract(packDir);
    expect(extracted.length).toBeGreaterThan(0);

    for (const [file, original] of before) {
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(original);
    }
  });
});
