import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";
const nodeBuiltins =
  /^(node:)?(fs|path|process|os|util|stream|buffer|events|crypto|url|assert|string_decoder)\/?.*$/;

export default defineConfig([
  {
    input: { index: "src/index.ts" },
    platform: "node",
    external: [nodeBuiltins, "cac"],
    plugins: [dts()],
    output: [
      {
        dir: "dist",
        format: "esm",
        entryFileNames: "[name].js",
      },
    ],
  },
]);
