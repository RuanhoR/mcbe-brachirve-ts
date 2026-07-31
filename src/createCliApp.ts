import { existsSync, statSync } from 'node:fs';

import { cac } from 'cac';
import type { CAC } from 'cac';

import { extract, generate } from './brarchive';

export interface CreateCliAppOptions {
  version?: string;
}

/**
 * Builds the `brarchive` CLI app with cac. Registering commands is kept here so
 * the app is easy to test/embed; the actual `cli.parse()` call lives in the bin
 * entry, which also handles "no args" and uncaught errors.
 */
export function createCliApp(options: CreateCliAppOptions = {}): CAC {
  const cli = cac('brarchive');

  cli
    .command('generate <directory>', 'Generate .brarchive files for every sub-directory')
    .action((directory: string) => {
      if (!existsSync(directory) || !statSync(directory).isDirectory()) {
        throw new Error(`Failed to find input directory: ${directory}`);
      }
      const written = generate(directory);
      console.log(`Generated ${written.length} archive(s) in ${directory}/__brarchive.`);
    });

  cli
    .command('extract <target>', 'Extract .brarchive files from a file or a directory')
    .action((target: string) => {
      if (!existsSync(target)) {
        throw new Error(`Failed to find input directory: ${target}`);
      }
      const written = extract(target);
      console.log(`Extracted ${written.length} file(s).`);
    });

  // cac dispatches `command:*` when no registered command matched.
  cli.addEventListener('command:*', () => {
    console.log(`Unknown command: ${cli.args[0]}`);
    process.exit(1);
  });

  if (options.version) {
    cli.version(options.version);
  }
  cli.help();

  return cli;
}
