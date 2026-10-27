# AGENTS.md

TypeScript library + CLI for reading/writing Minecraft Bedrock `.brarchive` files (port of xKingDark-brachive). Single-package pnpm project, ESM-only, Node >= 20.

## Commands

- `pnpm build` — bundle `src/index.ts` to `dist/index.js` (+ `dist/index.d.ts` via `rolldown-plugin-dts`) and `src/cli.ts` to the self-contained `dist/cli.cjs` via rolldown. Always run before exercising the CLI.
- `pnpm type-check` — `tsc --noEmit`. Does **not** cover tests: `tsconfig.json` `include` lists `"tests"` but the dir is `test/`. Don't trust it for test-file changes.
- `pnpm test` — `vitest run`, runs both projects. `pnpm test:unit` / `pnpm test:e2e` filter. e2e is slow (180s timeouts; copies fixtures to a temp dir and round-trips) — prefer `test:unit` for fast iteration.
- `pnpm dev` — `pnpm build && node dist/cli.cjs`; pass CLI args after, e.g. `pnpm dev -- extract <target>`.

## CLI

- The package has **no runtime `dependencies`**: `cac` is devDependency-only and gets bundled into `dist/cli.cjs`, which is what the `bin` entry (`brarchive`) executes. Library consumers (`dist/index.js`) never load the CLI framework. A build is required before running the CLI.
- `createCliApp()` (in `src/createCliApp.ts`) is the CLI factory; tests and the CLI entry (`src/cli.ts`) both use it. cac dispatches async actions without awaiting, so every action is tracked in `cli.pendingActions` and `src/cli.ts` waits on `Promise.all(cli.pendingActions)` — preserve this pattern.
- Commands: `brarchive generate <dir>` (packs every sub-dir into `<dir>/__brarchive/*.brarchive`), `brarchive extract <target> [-o <dir>]`. `--json` prints machine-readable output (errors still go to stderr).

## Format & behavioral gotchas (see README for the binary layout)

- Entry names are capped at 247 UTF-8 bytes; longer names are truncated.
- JSON entries are **minified on write/generate** (comments stripped + whitespace removed, mimicking rapidjson) and **pretty-printed with 4-space indent on read**. Unparseable JSON is treated as opaque text, kept byte-for-byte. Non-JSON payloads are never touched.
- `generate` skips any path containing `__brarchive`; `extract` in directory mode only collects `.brarchive` files under `__brarchive` and derives output folders from the archive path (e.g. `__brarchive/sub/foo.brarchive` → `sub/foo/`).
- Core entry points in `src/brarchive.ts`: `write`/`writeArchive` (stream dir → file vs. in-memory Buffer), `readArchive`, `generate`, `extract`. All I/O is bounded to 16 concurrent ops (`CONCURRENCY`); archives ≤ 16 MiB are read whole, larger ones entry-by-entry.
- `.gitignore` ignores `*.brarchive` globally **except** `test/e2e/fixtures/**/*.brarchive`, which are committed and required by the e2e tests — don't delete them, and use `git add -f` if you add new fixture archives.
