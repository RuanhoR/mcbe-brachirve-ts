import { defineConfig } from 'rolldown';

const nodeBuiltins = /^(node:)?(fs|path|process|os|util|stream|buffer|events|crypto|url|assert|string_decoder)\/?.*$/;

export default defineConfig([
  {
    input: { index: 'src/index.ts' },
    platform: 'node',
    external: [nodeBuiltins],
    output: [
      {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].mjs',
      },
      {
        dir: 'dist',
        format: 'cjs',
        entryFileNames: '[name].cjs',
        exports: 'named',
      },
    ],
  },
  {
    input: { cli: 'src/cli.ts' },
    platform: 'node',
    external: [nodeBuiltins],
    output: [
      {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].mjs',
        banner: '#!/usr/bin/env node',
      },
    ],
  },
]);
