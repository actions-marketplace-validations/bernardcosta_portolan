import type { HardCheck } from "./index";

/** Changed files that were not shown inline must be read before finish. */
export function unreadFiles(mustRead: string[]): HardCheck {
  return {
    name: "changed files not read",
    advice:
      "These changed files were not shown and you have not read them. Read them (read_diff or read_file).",
    run: ({ seen }) => mustRead.filter((p) => !seen.has(p)),
  };
}
