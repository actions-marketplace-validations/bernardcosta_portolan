import type { Agent } from "./agents";
import type { Provider, Turn, Usage } from "./providers/types";
import { type FinishResult, runTool, safeRel, type ToolRuntime, toolDefs } from "./tools";

/** The most the model may write in one reply: about 90 KB of text, enough for several whole pages. */
const MAX_OUTPUT_TOKENS = 32_000;

/**
 * When one request grows past this many input tokens, the contents of older tool results are cleared
 * from the history (the model can read a file again). The last few tool turns stay intact.
 * `SPRIGGS_CONTEXT_TOKENS` sets it; the default suits a 1M window. Set about 120000 for a 200K model.
 */
const CONTEXT_SOFT_LIMIT = Number(process.env.SPRIGGS_CONTEXT_TOKENS) || 600_000;
const KEEP_RECENT_TOOL_TURNS = 3;
const CLEARED = "[cleared to save context; call the tool again if you need this content]";
/** The share of any budget line after which an agent with a `nearBudget` message gets it, once. */
const NEAR_BUDGET = 0.8;

export type AgentResult = {
  result: FinishResult;
  usage: Usage;
  turns: number;
  /** Changed files the model saw: inline in the message, or through read_diff / read_file. */
  seen: Set<string>;
};

/** A budget or model error from the loop. Carries the usage so far, so a caller can still report cost. */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly usage: Usage,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

/** The agent loop: complete -> run tool calls -> append results, until `finish` or a budget runs out. */
export async function runAgent(opts: {
  agent: Agent;
  provider: Provider;
  rt: ToolRuntime;
  userMessage: string;
  /** Changed files whose diff is inline in the message. */
  inlineShown?: string[];
  /** Changed files the model must read before `finish` (not inline). The loop reminds it once. */
  mustRead?: string[];
}): Promise<AgentResult> {
  const { agent, rt } = opts;
  const { budget } = agent;
  const tools = toolDefs(agent.tools);
  const allowed = new Set<string>(agent.tools);
  const started = Date.now();
  const usage: Usage = { input: 0, output: 0, cached: 0 };
  const turns: Turn[] = [{ role: "user", text: opts.userMessage }];
  const seen = new Set(opts.inlineShown ?? []);
  let nudged = false;
  let reminded = false;
  let cutOnce = false;
  let warned = false;

  for (let turn = 1; turn <= budget.maxTurns; turn++) {
    const elapsed = Date.now() - started;
    // Cached input is nearly free and counts once; every turn re-sends the whole history.
    const spent = usage.input - usage.cached + usage.output;
    if (elapsed > budget.timeoutMs)
      throw new AgentError(`agent loop timed out after ${budget.timeoutMs} ms`, usage);
    if (spent > budget.maxTokens)
      throw new AgentError(`agent loop exceeded ${budget.maxTokens} uncached tokens`, usage);
    if (
      agent.nearBudget &&
      !warned &&
      (turn > NEAR_BUDGET * budget.maxTurns ||
        spent > NEAR_BUDGET * budget.maxTokens ||
        elapsed > NEAR_BUDGET * budget.timeoutMs)
    ) {
      warned = true;
      turns.push({ role: "user", text: agent.nearBudget });
      console.log("  budget: nearly spent; told the model to wrap up");
    }

    const c = await opts.provider.complete({
      system: agent.system,
      turns,
      tools,
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

    // A reply cut at the output limit: its tool calls, if any, are incomplete. One retry with clear advice.
    if (c.stop === "max_tokens" || c.stop === "length") {
      if (cutOnce)
        throw new AgentError("the model's reply was cut at the output limit twice", usage);
      cutOnce = true;
      const advice = `Your reply was cut at the output limit of ${MAX_OUTPUT_TOKENS} tokens. Write the file in a shorter form, or split the page into two files, and try again.`;
      turns.push(
        c.calls.length
          ? {
              role: "tool",
              results: c.calls.map((x) => ({ id: x.id, content: advice, isError: true })),
            }
          : { role: "user", text: advice },
      );
      console.log("  reply cut at the output limit; asked for a shorter one");
      continue;
    }

    if (c.calls.length === 0) {
      if (rt.finished) break;
      if (nudged) throw new AgentError("the model stopped without calling finish", usage);
      nudged = true;
      turns.push({ role: "user", text: "Call the finish tool now with the result of this run." });
      continue;
    }

    const results = [];
    for (const call of c.calls) {
      let r = allowed.has(call.name)
        ? await runTool(rt, call.name, call.input)
        : { content: `tool ${call.name} is not available to this agent`, isError: true };
      const path = safeRel(pathOf(call.input));
      if (
        !r.isError &&
        !r.partial &&
        path &&
        (call.name === "read_diff" || call.name === "read_file")
      )
        seen.add(path);
      // Files not shown inline must be read before finishing. One reminder; the second finish is accepted.
      if (call.name === "finish" && !r.isError && !reminded) {
        const missed = (opts.mustRead ?? []).filter((p) => !seen.has(p));
        if (missed.length) {
          reminded = true;
          rt.finished = undefined;
          r = {
            isError: true,
            content: `Not yet. These changed files were not shown and you have not read them; read them (read_diff or read_file), then call finish again:\n${missed.map((p) => `- ${p}`).join("\n")}`,
          };
          console.log(`  finish: ${missed.length} changed file(s) not read yet`);
        }
      }
      if (r.isError) console.log(`  ${call.name}: ${r.content.split("\n")[0]}`);
      results.push({ id: call.id, content: r.content, isError: r.isError });
    }
    turns.push({ role: "tool", results });
    if (rt.finished) return { result: rt.finished, usage, turns: turn, seen };
  }
  if (rt.finished) return { result: rt.finished, usage, turns: turns.length, seen };
  throw new AgentError(`agent loop hit the ${budget.maxTurns} turn limit without finishing`, usage);
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

function pathOf(input: unknown): unknown {
  return typeof input === "object" && input !== null
    ? (input as { path?: unknown }).path
    : undefined;
}
