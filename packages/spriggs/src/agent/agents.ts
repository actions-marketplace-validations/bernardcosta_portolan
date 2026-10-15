import { SYSTEM_PROMPT } from "./prompt";
import { SURVEY_SYSTEM_PROMPT, VERIFY_SYSTEM_PROMPT } from "./survey-prompt";
import type { ToolName } from "./tools";

/** `maxTokens` counts uncached input plus output: cached input is nearly free. */
export type Budget = { maxTurns: number; maxTokens: number; timeoutMs: number };

/** One harness: a system prompt, the tools it takes from the pool, and its limits. */
export type Agent = {
  name: string;
  system: string;
  tools: ToolName[];
  budget: Budget;
  /** Sent once as a user message when 80% of any budget line is spent. */
  nearBudget?: string;
};

/** The pull request agent. Large changes read more files over more turns; most input is cached. */
export function docsAgent(tier: "small" | "large"): Agent {
  return {
    name: "docs",
    system: SYSTEM_PROMPT,
    tools: [
      "list_files",
      "search",
      "read_file",
      "read_diff",
      "write_doc",
      "move_doc",
      "delete_doc",
      "finish",
    ],
    budget:
      tier === "large"
        ? { maxTurns: 40, maxTokens: 1_500_000, timeoutMs: 15 * 60 * 1000 }
        : { maxTurns: 30, maxTokens: 600_000, timeoutMs: 10 * 60 * 1000 },
  };
}

/**
 * The survey agent: explores the repository and writes the docs spine plus a page per big part.
 * The budget is the ceiling on cost for any repository; docs/todo.md carries what was left to write or check.
 */
export const SURVEY_AGENT: Agent = {
  name: "survey",
  system: SURVEY_SYSTEM_PROMPT,
  tools: ["list_files", "search", "read_file", "write_doc", "move_doc", "delete_doc", "finish"],
  budget: {
    maxTurns: 120,
    maxTokens: Number(process.env.SPRIGGS_SURVEY_TOKENS) || 2_000_000,
    timeoutMs: 45 * 60 * 1000,
  },
  nearBudget:
    "Most of the budget is spent. Stop exploring now. Rewrite docs/todo.md so it lists exactly the pages you did not write or did not fully check, then call finish.",
};

/** The check pass after a survey. A fresh context; it corrects only claims the code does not support. */
export const VERIFY_AGENT: Agent = {
  name: "verify",
  system: VERIFY_SYSTEM_PROMPT,
  tools: ["list_files", "search", "read_file", "write_doc", "finish"],
  budget: { maxTurns: 60, maxTokens: 1_000_000, timeoutMs: 20 * 60 * 1000 },
  nearBudget:
    "Most of the budget is spent. Write the corrections you have evidence for now, then call finish and name the pages you did not fully check.",
};
