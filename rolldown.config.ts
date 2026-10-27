import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";
const nodeBuiltins =
  /^(node:)?(fs|path|process|os|util|stream|buffer|events|crypto|url|assert|string_decoder)\/?.*$/;

export default defineConfig([
  // Library bundle: no runtime dependencies (cac is only used by the CLI below
  // and gets inlined there), so consumers importing the library install nothing.
  {
    input: { index: "src/index.ts" },
    platform: "node",
    external: [nodeBuiltins],
    plugins: [dts()],
    output: [
      {
        dir: "dist",
        format: "esm",
        entryFileNames: "[name].js",
      },
    ],
  },
  // Self-contained CLI bundle: cac and the library code are bundled in, which
  // is what the `bin` entry executes (via global install / npx).
  {
    input: { cli: "src/cli.ts" },
    platform: "node",
    external: [nodeBuiltins],
    output: [
      {
        dir: "dist",
        format: "cjs",
        entryFileNames: "[name].cjs",
        banner: "#!/usr/bin/env node",
      },
    ],
  },
]);
