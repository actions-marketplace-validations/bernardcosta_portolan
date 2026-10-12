#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { GitHubForge } from "./forge/github";
import { LocalForge } from "./forge/local";
import { init } from "./init";
import { run } from "./run";

const USAGE = `Usage:
  portolan spriggs run [--local --base <ref> [--reason <text>]] [--model <provider/model>]
  portolan spriggs init [--model <provider/model>]`;

async function main(argv: string[]): Promise<number> {
  // `portolan spriggs run ...` from the bin, `bun run spriggs run ...` from the root script.
  const [command, ...rest] = argv[0] === "spriggs" ? argv.slice(1) : argv;
  if (command !== "run" && command !== "init") {
    console.error(USAGE);
    return 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      local: { type: "boolean", default: false },
      base: { type: "string" },
      reason: { type: "string" },
      model: { type: "string" },
    },
  });
  const model = values.model ? { model: values.model } : {};
  if (command === "init") return init(model);
  if (values.local && !values.base) {
    console.error("--local needs --base <ref>");
    return 2;
  }
  const forge =
    values.local && values.base
      ? new LocalForge(values.base, values.reason ?? "")
      : new GitHubForge();
  return run(forge, model);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`spriggs: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
