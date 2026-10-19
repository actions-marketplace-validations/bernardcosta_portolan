import { existsSync } from "node:fs";
import { join } from "node:path";
import { effort, VERIFY_AGENT } from "./agent/agents";
import { AgentError, runAgent } from "./agent/loop";
import type { Provider, Usage } from "./agent/providers/types";
import { buildVerifyMessage } from "./agent/survey-prompt";
import { readableFile, type ToolRuntime } from "./agent/tools";
import { flat } from "./report";

const n = (x: number) => x.toLocaleString("en-US");

/**
 * What one checker reads well in its budget: a batch holds pages up to this many characters, and at
 * most this many pages. A small scope gives a deeper check (20261015-verify: twice the errors fixed).
 */
const BATCH_CHARS = 40_000;
const BATCH_PAGES = 6;
/** Checkers that run at the same time. Providers limit concurrent requests. */
const VERIFY_PARALLEL = 3;
/**
 * The check pass's own budget in uncached tokens, the unit of every agent budget. It sets how many
 * checkers a run may start; the default is one round of three. A runtime with no job timeout can
 * raise it. The pages and their covers are repository content, so the limit is never a model's call.
 */
const checkTokens = () => Number(process.env.SPRIGGS_CHECK_TOKENS) || 3_000_000;

/** `written`: the run wrote this page, so every claim on it is new. Otherwise it only covers changed code. */
type Page = { path: string; content: string; written: boolean };

/** `pages` counts only the pages whose checker finished; the notes name the pages that were not checked. */
type VerifyResult = { notes: string; usage: Usage; turns: number; pages: number };

/** The current content of each markdown page that exists, in order, without repeats. No symlinks, as read_file. */
export async function loadPages(
  cwd: string,
  paths: Iterable<string>,
): Promise<{ path: string; content: string }[]> {
  const pages = [];
  for (const path of new Set(paths)) {
    const abs = join(cwd, path);
    if (path.endsWith(".md") && existsSync(abs) && readableFile(cwd, path))
      pages.push({ path, content: await Bun.file(abs).text() });
  }
  return pages;
}

/**
 * The check pass: fresh agents, one per small batch of pages, check each claim against the code and
 * correct what the code does not support. It never fails the run; a checker that stops keeps the
 * corrections it wrote. The checkers share `rt.originals`, so the run's post-run check sees and
 * can revert every correction, also on a page the run itself did not write.
 * Skipped, with no result, when `SPRIGGS_EFFORT` is `low` or there is no page.
 * `pages` come in order of importance: the ones that do not fit the budget are named in the notes.
 */
export async function verify(
  provider: Provider,
  rt: ToolRuntime,
  pages: Page[],
  changedFiles?: string[],
): Promise<VerifyResult | undefined> {
  if (effort() === "low" || !pages.length) return undefined;
  const checkers = Math.max(1, Math.floor(checkTokens() / VERIFY_AGENT.budget.maxTokens));
  const { batches, left } = toBatches(pages, checkers);
  console.log(
    `\nverify: checking ${pages.length - left.length} page(s) in ${batches.length} batch(es)${left.length ? `, ${left.length} left out by the budget` : ""}`,
  );

  let usage: Usage = { input: 0, output: 0, cached: 0 };
  let turns = 0;
  let checked = 0;
  const notes: string[] = [];
  const queue = [...batches];
  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      const r = await checkBatch(provider, rt, batch, changedFiles);
      usage = sum(usage, r.usage);
      turns += r.turns;
      checked += r.checked;
      // One list item per line: GitHub joins plain lines into one paragraph.
      for (const line of r.notes.split("\n").map((l) => l.trim()))
        if (line) notes.push(line.startsWith("- ") ? line : `- ${line}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(VERIFY_PARALLEL, batches.length) }, worker));
  if (left.length)
    notes.push(
      `- not checked, over the check budget (SPRIGGS_CHECK_TOKENS): ${left.map((p) => p.path).join(", ")}`,
    );
  console.log(`verify: done: ${usageLine(usage)}`);
  return { notes: notes.join("\n"), usage, turns, pages: checked };
}

/** One checker with its own finish result; it may write only the pages of its batch. */
async function checkBatch(
  provider: Provider,
  rt: ToolRuntime,
  batch: Page[],
  changedFiles?: string[],
) {
  const own: ToolRuntime = {
    ...rt,
    writable: new Set(batch.map((p) => p.path)),
    finished: undefined,
  };
  try {
    const a = await runAgent({
      agent: VERIFY_AGENT,
      provider,
      rt: own,
      userMessage: buildVerifyMessage(batch, changedFiles),
    });
    return { notes: a.result.notes, usage: a.usage, turns: a.turns, checked: batch.length };
  } catch (e) {
    // The budget, the context window or the model gave out. The corrections written so far stay.
    const reason = flat((e instanceof Error && e.message) || String(e));
    console.warn(`verify stopped: ${reason}`);
    return {
      notes: `could not check ${batch.map((p) => p.path).join(", ")}: ${reason}`,
      usage: e instanceof AgentError ? e.usage : { input: 0, output: 0, cached: 0 },
      turns: 0,
      checked: 0,
    };
  }
}

/**
 * Batches filled by size, in page order: a page joins the first batch with room, else opens a new one
 * while fewer than `max` exist, else is left out. A page larger than a batch gets one of its own.
 */
function toBatches(pages: Page[], max: number): { batches: Page[][]; left: Page[] } {
  const batches: Page[][] = [];
  const left: Page[] = [];
  const size = (b: Page[]) => b.reduce((n, p) => n + p.content.length, 0);
  for (const p of pages) {
    const room = batches.find(
      (b) => b.length < BATCH_PAGES && size(b) + p.content.length <= BATCH_CHARS,
    );
    if (room) room.push(p);
    else if (batches.length < max) batches.push([p]);
    else left.push(p);
  }
  return { batches, left };
}

export const sum = (a: Usage | undefined, b: Usage): Usage => ({
  input: (a?.input ?? 0) + b.input,
  output: (a?.output ?? 0) + b.output,
  cached: (a?.cached ?? 0) + b.cached,
});

export function usageLine(u: Usage): string {
  return `${n(u.input)} input tokens (${n(u.cached)} from cache), ${n(u.output)} output tokens`;
}
