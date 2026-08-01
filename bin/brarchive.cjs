#!/usr/bin/env node
// CLI entry point: wires up the cac app (built into dist/cli.mjs) and parses argv.
const { createCliApp } = require('..');

async function _() { 
  const cli = createCliApp({ version: require("../package.json").version });

try {
  cli.parse();
  // cac dispatches async actions without waiting; wait for them all here so the
  // process does not exit before the I/O finishes.
  await Promise.all(cli.pendingActions);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
}
_()