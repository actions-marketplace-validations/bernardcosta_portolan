#!/usr/bin/env bun
import { parseArgs } from "node:util";

const USAGE = `Usage: portolan spriggs run [--local --base <ref>] [--model <provider/model>]`;

function main(argv: string[]): number {
  // `portolan spriggs run ...` from the bin, `bun run spriggs run ...` from the root script.
  const [command, ...rest] = argv[0] === "spriggs" ? argv.slice(1) : argv;
  if (command !== "run") {
    console.error(USAGE);
    return 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      local: { type: "boolean", default: false },
      base: { type: "string" },
      model: { type: "string" },
    },
  });
  if (values.local && !values.base) {
    console.error("--local needs --base <ref>");
    return 2;
  }
  // M1 adds the pipeline here: context -> gate -> comment -> label.
  console.log(
    `spriggs run: local=${values.local} base=${values.base ?? "-"} model=${values.model ?? "-"}`,
  );
  return 0;
}

process.exit(main(process.argv.slice(2)));
