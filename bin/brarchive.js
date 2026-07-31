#!/usr/bin/env node
import { createCliApp } from '../dist/cli.mjs';

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
