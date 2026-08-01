import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCliApp } from '../../src/createCliApp';

const tempDirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'brarchive-cli-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function runCli(...args: string[]) {
  vi.restoreAllMocks();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const cli = createCliApp();
  cli.parse(['node', 'brarchive.cjs', ...args]);
  return Promise.all(cli.pendingActions).then(() => log);
}

describe('cli --json', () => {
  it('prints generate output as JSON', async () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');

    const log = await runCli('generate', root, '--json');
    expect(log).toHaveBeenCalledTimes(1);
    const out = JSON.parse(log.mock.calls[0][0] as string);
    expect(out.count).toBe(1);
    expect(out.archives).toContain(join(root, '__brarchive', 'a.brarchive'));
  });

  it('accepts --json before the command (global option)', async () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');

    const log = await runCli('--json', 'generate', root);
    const out = JSON.parse(log.mock.calls[0][0] as string);
    expect(out.archives).toContain(join(root, '__brarchive', 'a.brarchive'));
  });

  it('prints extract output as JSON', async () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');

    await runCli('generate', root);
    const log = await runCli('extract', root, '--json');
    const out = JSON.parse(log.mock.calls[0][0] as string);
    expect(out.count).toBe(1);
    expect(out.files).toContain(join(root, 'a', 'x.json'));
  });

  it('keeps human-readable output without --json', async () => {
    const root = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');

    const log = await runCli('generate', root);
    expect(log.mock.calls[0][0]).toMatch(/^Generated 1 archive\(s\)/);
  });

  it('extracts to a custom output dir with --output', async () => {
    const root = makeDir();
    const out = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');

    await runCli('generate', root);
    const log = await runCli('extract', root, '--output', out, '--json');
    const parsed = JSON.parse(log.mock.calls[0][0] as string);
    expect(parsed.count).toBe(1);
    expect(parsed.files).toContain(join(out, 'a', 'x.json'));
  });

  it('extracts a single archive with -o', async () => {
    const root = makeDir();
    const out = makeDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.json'), '{"x":1}');
    await runCli('generate', root);

    const archive = join(root, '__brarchive', 'a.brarchive');
    const log = await runCli('extract', archive, '-o', out, '--json');
    const parsed = JSON.parse(log.mock.calls[0][0] as string);
    expect(parsed.files).toContain(join(out, 'x.json'));
  });
});
