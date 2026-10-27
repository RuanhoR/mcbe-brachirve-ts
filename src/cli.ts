import { createCliApp } from "./createCliApp";
import pkg from "../package.json";

const cli = createCliApp({ version: pkg.version });

async function main() {
  try {
    cli.parse();
    // cac dispatches async actions without waiting; wait for them all here so
    // the process does not exit before the I/O finishes.
    await Promise.all(cli.pendingActions);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
