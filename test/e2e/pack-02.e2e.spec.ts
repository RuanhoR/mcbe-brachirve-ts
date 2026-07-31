import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extract, generate, readArchive } from '../../src/index';

const FIXTURE = join(process.cwd(), 'test', 'e2e', 'fixtures', '02');

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

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'brarchive-e2e-02-'));
  packDir = join(workDir, 'pack');
  cpSync(FIXTURE, packDir, { recursive: true });
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('fixture 02 packing e2e', () => {
  it('unpacks fixture 02, then packs the unpacked content back (round-trip)', () => {
    // 解包：__brarchive/*.brarchive -> 普通文件夹
    const unpacked = extract(packDir);
    expect(unpacked.length).toBeGreaterThan(0);
    expect(existsSync(join(packDir, 'animations'))).toBe(true);
    expect(existsSync(join(packDir, 'models', 'entity'))).toBe(true);
    expect(existsSync(join(packDir, 'textures', 'entity', 'sulfur_cube'))).toBe(true);

    // 记录解包出的所有 JSON 内容
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

    // 打包：用解包结果重新生成 .brarchive
    const written = generate(packDir);
    expect(written.length).toBeGreaterThan(0);
    for (const archive of written) {
      // __brarchive/models/entity.brarchive -> 源目录 models/entity
      const srcRel = archive
        .slice(packDir.length + 1)
        .replace(/^__brarchive[/\\]/, '')
        .replace(/\.brarchive$/, '');
      const srcDir = join(packDir, srcRel);
      const expected = readdirSync(srcDir, { withFileTypes: true }).filter((e) => e.isFile()).length;
      expect(readArchive(archive).length).toBe(expected);
    }

    // 再次解包后所有 JSON 内容应与第一次解包一致
    extract(packDir);
    for (const [file, original] of before) {
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(original);
    }
  });
});
