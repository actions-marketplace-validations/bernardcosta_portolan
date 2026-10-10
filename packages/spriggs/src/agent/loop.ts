import { SYSTEM_PROMPT } from "./prompt";
import type { Provider, Turn, Usage } from "./providers/types";
import { type FinishResult, runTool, TOOL_DEFS, type ToolRuntime } from "./tools";

export type Budget = { maxTurns: number; maxTokens: number; timeoutMs: number };
export const SMALL_BUDGET: Budget = { maxTurns: 30, maxTokens: 600_000, timeoutMs: 10 * 60 * 1000 };
/** Large changes read more files over more turns; most input is cached. */
export const LARGE_BUDGET: Budget = {
  maxTurns: 40,
  maxTokens: 1_500_000,
  timeoutMs: 15 * 60 * 1000,
};

const MAX_OUTPUT_TOKENS = 16_000;

/**
 * When one request grows past this many input tokens, the contents of older tool results are cleared
 * from the history (the model can read a file again). The last few tool turns stay intact.
 * `SPRIGGS_CONTEXT_TOKENS` sets it; the default suits a 1M window. Set about 120000 for a 200K model.
 */
const CONTEXT_SOFT_LIMIT = Number(process.env.SPRIGGS_CONTEXT_TOKENS) || 600_000;
const KEEP_RECENT_TOOL_TURNS = 3;
const CLEARED = "[cleared to save context; call the tool again if you need this content]";

export type AgentResult = {
  result: FinishResult;
  usage: Usage;
  turns: number;
  /** Changed files the model saw: inline in the message, or through read_diff / read_file. */
  seen: Set<string>;
};

/** The agent loop: complete -> run tool calls -> append results, until `finish` or a budget runs out. */
export async function runAgent(opts: {
  provider: Provider;
  rt: ToolRuntime;
  userMessage: string;
  /** Changed files whose diff is inline in the message. */
  inlineShown?: string[];
  /** Changed files the model must read before `finish` (not inline). The loop reminds it once. */
  mustRead?: string[];
  budget?: Budget;
}): Promise<AgentResult> {
  const budget = opts.budget ?? SMALL_BUDGET;
  const started = Date.now();
  const usage: Usage = { input: 0, output: 0, cached: 0 };
  const turns: Turn[] = [{ role: "user", text: opts.userMessage }];
  const seen = new Set(opts.inlineShown ?? []);
  let nudged = false;
  let reminded = false;

  for (let turn = 1; turn <= budget.maxTurns; turn++) {
    if (Date.now() - started > budget.timeoutMs)
      throw new Error(`agent loop timed out after ${budget.timeoutMs} ms`);
    if (usage.input + usage.output > budget.maxTokens)
      throw new Error(`agent loop exceeded ${budget.maxTokens} tokens`);

    const c = await opts.provider.complete({
      system: SYSTEM_PROMPT,
      turns,
      tools: TOOL_DEFS,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    usage.input += c.usage.input;
    usage.output += c.usage.output;
    usage.cached += c.usage.cached;
    turns.push({ role: "assistant", text: c.text, calls: c.calls, raw: c.raw });
    if (c.usage.input > CONTEXT_SOFT_LIMIT) clearOldToolResults(turns);
    console.log(
      `turn ${turn}: ${c.calls.map((x) => x.name).join(", ") || `no tool call (${c.stop})`}`,
    );

    if (c.calls.length === 0) {
      if (opts.rt.finished) break;
      if (nudged) throw new Error("the model stopped without calling finish");
      nudged = true;
      turns.push({ role: "user", text: "Call the finish tool now with the result of this run." });
      continue;
    }

    const results = [];
    for (const call of c.calls) {
      let r = await runTool(opts.rt, call.name, call.input);
      const path = pathOf(call.input);
      if (!r.isError && path && (call.name === "read_diff" || call.name === "read_file"))
        seen.add(path);
      // Files not shown inline must be read before finishing. One reminder; the second finish is accepted.
      if (call.name === "finish" && !r.isError && !reminded) {
        const missed = (opts.mustRead ?? []).filter((p) => !seen.has(p));
        if (missed.length) {
          reminded = true;
          opts.rt.finished = undefined;
          r = {
            isError: true,
            content: `Not yet. These changed files were not shown and you have not read them; read them (read_diff or read_file), then call finish again:\n${missed.map((p) => `- ${p}`).join("\n")}`,
          };
          console.log(`  finish: ${missed.length} changed file(s) not read yet`);
        }
      }
      if (r.isError) console.log(`  ${call.name}: ${r.content.split("\n")[0]}`);
      results.push({ id: call.id, ...r });
    }
    turns.push({ role: "tool", results });
    if (opts.rt.finished) return { result: opts.rt.finished, usage, turns: turn, seen };
  }
  if (opts.rt.finished) return { result: opts.rt.finished, usage, turns: turns.length, seen };
  throw new Error(`agent loop hit the ${budget.maxTurns} turn limit without finishing`);
}

/** Replaces the content of tool results older than the last few tool turns. Ids and order stay. */
function clearOldToolResults(turns: Turn[]): void {
  const toolTurns = turns.filter((t) => t.role === "tool");
  let cleared = 0;
  for (const t of toolTurns.slice(0, -KEEP_RECENT_TOOL_TURNS)) {
    if (t.role !== "tool") continue;
    for (const r of t.results) {
      if (r.content !== CLEARED && r.content.length > CLEARED.length) {
        r.content = CLEARED;
        cleared++;
      }
    }
  }
  if (cleared) console.log(`  context: cleared ${cleared} older tool result(s)`);
}

function pathOf(input: unknown): string | undefined {
  const p =
    typeof input === "object" && input !== null ? (input as { path?: unknown }).path : undefined;
  return typeof p === "string" ? p.replace(/^\.\//, "") : undefined;
}
