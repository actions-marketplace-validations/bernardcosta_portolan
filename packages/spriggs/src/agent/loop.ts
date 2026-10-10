import { SYSTEM_PROMPT } from "./prompt";
import type { Provider, Turn, Usage } from "./providers/types";
import { type FinishResult, runTool, TOOL_DEFS, type ToolRuntime } from "./tools";

export type Budget = { maxTurns: number; maxTokens: number; timeoutMs: number };
export const DEFAULT_BUDGET: Budget = {
  maxTurns: 30,
  maxTokens: 600_000,
  timeoutMs: 10 * 60 * 1000,
};

const MAX_OUTPUT_TOKENS = 16_000;

/** The agent loop: complete -> run tool calls -> append results, until `finish` or a budget runs out. */
export async function runAgent(opts: {
  provider: Provider;
  rt: ToolRuntime;
  userMessage: string;
  budget?: Budget;
}): Promise<{ result: FinishResult; usage: Usage; turns: number }> {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const started = Date.now();
  const usage: Usage = { input: 0, output: 0, cached: 0 };
  const turns: Turn[] = [{ role: "user", text: opts.userMessage }];
  let nudged = false;

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
      const r = await runTool(opts.rt, call.name, call.input);
      if (r.isError) console.log(`  ${call.name}: ${r.content}`);
      results.push({ id: call.id, ...r });
    }
    turns.push({ role: "tool", results });
    if (opts.rt.finished) return { result: opts.rt.finished, usage, turns: turn };
  }
  if (opts.rt.finished) return { result: opts.rt.finished, usage, turns: turns.length };
  throw new Error(`agent loop hit the ${budget.maxTurns} turn limit without finishing`);
}
