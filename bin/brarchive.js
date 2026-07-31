#!/usr/bin/env node
// CLI entry point: wires up the cac app (built into dist/cli.mjs) and parses argv.
import { createCliApp } from '../dist/cli.mjs';

// The original C++ tool printed "No args." and exited non-zero.
if (process.argv.length <= 2) {
  console.error('No args.');
  process.exit(1);
}

const cli = createCliApp({ version: '1.0.0' });

try {
  cli.parse();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
