import { existsSync, statSync } from 'node:fs';

import { extract, generate } from './brarchive';

const [, , command, target] = process.argv;

if (!command) {
  console.error('No args.');
  process.exit(1);
}

try {
  if (command === 'generate') {
    if (!target || !existsSync(target)) {
      console.error('Failed to find input directory.');
      process.exit(1);
    }
    if (!statSync(target).isDirectory()) {
      console.error('Failed to find input directory.');
      process.exit(1);
    }
    const written = generate(target);
    console.log(`Generated ${written.length} archive(s) in ${target}/__brarchive.`);
  } else if (command === 'extract') {
    if (!target || !existsSync(target)) {
      console.error('Failed to find input directory.');
      process.exit(1);
    }
    const written = extract(target);
    console.log(`Extracted ${written.length} file(s).`);
  } else {
    console.log(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
