import type { ToolRuntime } from "../agent/tools";

/** What a hard check sees when the model calls finish. */
export type CheckState = {
  rt: ToolRuntime;
  /** Changed files the model saw: inline, or through read_diff / read_file. */
  seen: ReadonlySet<string>;
};

/**
 * A documentation hard check: something about the docs that code can prove, with no model.
 * The loop runs the checks when the model calls finish, and refuses that finish once with the problems.
 */
export type HardCheck = {
  /** For the log. */
  name: string;
  /** Shown to the model above the list: what is wrong and what to do. */
  advice: string;
  /** One line per problem; empty when the docs pass. */
  run(state: CheckState): string[];
};

/** The message that refuses the finish, or undefined when every check passes. */
export function runHardChecks(checks: HardCheck[], state: CheckState): string | undefined {
  const failed: string[] = [];
  for (const check of checks) {
    const problems = check.run(state);
    if (!problems.length) continue;
    // Counts only: the problem lines hold file names from the repository.
    console.log(`  finish: ${check.name}: ${problems.length}`);
    failed.push(`${check.advice}\n${problems.map((p) => `- ${p}`).join("\n")}`);
  }
  return failed.length
    ? `Not yet. Fix these, then call finish again.\n\n${failed.join("\n\n")}`
    : undefined;
}
