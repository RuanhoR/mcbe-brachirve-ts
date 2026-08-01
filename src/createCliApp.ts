import { existsSync, statSync } from "node:fs";

import { cac } from "cac";
import type { CAC } from "cac";

import { extract, generate } from "./brarchive";

export interface CreateCliAppOptions {
  version?: string;
}

interface CliOptions {
  json?: boolean;
  output?: string;
}

/**
 * Runs `fn` and keeps its promise so the bin entry can `await` all pending
 * actions after `cli.parse()` (cac dispatches async actions without waiting).
 */
function trackAction(
  pending: Promise<unknown>[],
  fn: () => Promise<void>,
): Promise<void> {
  const p = fn().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
  pending.push(p);
  return p;
}

/**
 * Prints the result of a command. With `--json` the payload is written to
 * stdout as a single JSON document (errors still go to stderr), which makes the
 * output easy to consume from scripts.
 */
function printResult(payload: unknown, human: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(human);
  }
}

/**
 * Builds the `brarchive` CLI app with cac. Registering commands is kept here so
 * the app is easy to test/embed; the actual `cli.parse()` call lives in the bin
 * entry, which also handles "no args" and uncaught errors.
 */
export function createCliApp(options: CreateCliAppOptions = {}): CAC {
  const cli = cac("brarchive");
  const pending: Promise<unknown>[] = [];
  Object.defineProperty(cli, "pendingActions", { value: pending });

  cli.option("--json", "Output results as JSON");

  cli
    .command(
      "generate <directory>",
      "Generate .brarchive files for every sub-directory",
    )
    .action((directory: string, opts: CliOptions) =>
      trackAction(pending, async () => {
        if (!existsSync(directory) || !statSync(directory).isDirectory()) {
          throw new Error(`Failed to find input directory: ${directory}`);
        }
        const written = await generate(directory);
        printResult(
          { archives: written, count: written.length },
          `Generated ${written.length} archive(s) in ${directory}/__brarchive.`,
          opts.json === true,
        );
      }),
    );

  cli
    .command(
      "extract <target>",
      "Extract .brarchive files from a file or a directory",
    )
    .option("-o, --output <dir>", "Extract to <dir> instead of next to the input")
    .action((target: string, opts: CliOptions) =>
      trackAction(pending, async () => {
        if (!existsSync(target)) {
          throw new Error(`Failed to find input directory: ${target}`);
        }
        const written = await extract(target, opts.output);
        printResult(
          { files: written, count: written.length },
          `Extracted ${written.length} file(s).`,
          opts.json === true,
        );
      }),
    );

  // cac dispatches `command:*` when no registered command matched.
  cli.addEventListener("command:*", () => {
    console.log(`Unknown command: ${cli.args[0]}`);
    process.exit(1);
  });
  if (options.version) {
    cli.version(options.version);
  }
  cli.help();

  return cli;
}
