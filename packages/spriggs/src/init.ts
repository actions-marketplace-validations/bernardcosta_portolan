import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { INIT_AGENT, VERIFY_AGENT } from "./agent/agents";
import { buildInitMessage, buildVerifyMessage, TODO_PATH } from "./agent/init-prompt";
import { AgentError, runAgent } from "./agent/loop";
import { resolveProvider } from "./agent/model";
import type { Provider, Usage } from "./agent/providers/types";
import { createRuntime, readableFile, type ToolRuntime } from "./agent/tools";
import { deadLinks } from "./checks/links";
import { splitFrontmatter } from "./docs/frontmatter";
import { loadPortolanConfig } from "./docs/portolan";
import { docsIndex } from "./docs/tree";
import { enforce } from "./enforce";
import { git } from "./git";
import { flat, renderInitReport } from "./report";

const n = (x: number) => x.toLocaleString("en-US");

/** Exit code when the run stopped before `finish`: the pages written stay, but the set is not complete. */
export const STOPPED_EARLY = 3;

/**
 * Cold start: the init agent explores the repository and writes docs/ in the working tree.
 * Nothing is committed here: locally the author reviews the result and opens the pull request;
 * in CI the action does (scripts/open-init-pr.sh).
 * Returns 0, 1 when the post-run check failed, or `STOPPED_EARLY`.
 */
export async function init(opts: { cwd?: string; model?: string } = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const provider = resolveProvider(opts.model);
  const { config, errors } = await loadPortolanConfig(cwd);
  for (const e of errors) console.warn(`warning: ${e}`);
  const index = await docsIndex(cwd);
  // Untracked files are readable too: a developer may run init before the first commit.
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd)
    .trim()
    .split("\n")
    .filter(Boolean);
  const rt = createRuntime(cwd, new Map(), untracked);
  // The todo is the memory between runs: what the last run did not write or check.
  const todo = await todoBody(cwd);
  console.log(`init: ${provider.model}, ${index.length} existing docs`);

  let notes = "";
  let checked = "";
  let stopped: string | undefined;
  let usage: Usage | undefined;
  let turns: number | undefined;
  try {
    const agent = await runAgent({
      agent: INIT_AGENT,
      provider,
      rt,
      checks: [deadLinks],
      userMessage: buildInitMessage({
        name: config?.name,
        index,
        tree: fileTree(rt.readable),
        // Capped like the file outline: the page is the repository's content, and it can be any size.
        todo: todo?.slice(0, 20_000),
      }),
    });
    notes = agent.result.notes;
    usage = agent.usage;
    turns = agent.turns;
    console.log(`done in ${agent.turns} turns: ${usageLine(agent.usage)}`);
    const v = await verify(provider, rt);
    if (v) {
      checked = v.notes;
      usage = sum(usage, v.usage);
      turns += v.turns;
    }
  } catch (e) {
    // The budget, the context window or the model gave out. The pages written so far stay;
    // the todo page is the honest list of what is left.
    // Never empty: this value is also what marks the run as stopped.
    stopped = flat((e instanceof Error && e.message) || String(e)) || "unknown error";
    if (e instanceof AgentError) usage = e.usage;
    console.warn(
      `stopped early: ${stopped}${usage ? `; ${usageLine(usage)}` : ""}. Keeping the pages written so far.`,
    );
  }

  const check = await enforce(rt, { strictTree: false, maxLines: Number.POSITIVE_INFINITY });
  if (!check.ok) {
    console.error(
      `check failed: ${flat(check.reason)}. The files are left in place for you to review.`,
    );
    return 1;
  }

  const left = await todoLeft(rt);
  // A todo from an earlier run that the model cleared: its removal is part of the pull request.
  const removedTodo = left === 0 && rt.originals.get(TODO_PATH) != null;
  const written = check.written.filter((p) => p !== TODO_PATH || left > 0);
  // The action takes the text between the two marker lines as the body of the pull request.
  const report = renderInitReport({
    written,
    created: check.created,
    left,
    removedTodo,
    notes,
    checked,
    stopped,
    usage,
    model: provider.model,
    turns,
  });
  console.log(`\n--- init result ---\n${report}\n--- end ---`);
  console.log("Review the changes in docs/, then commit them and open a pull request.");
  return stopped === undefined ? 0 : STOPPED_EARLY;
}

/** Pages per checker. A small scope gives a deeper check (20261015-verify: twice the errors fixed). */
const VERIFY_BATCH = 3;
/** Checkers that run at the same time. Providers limit concurrent requests. */
const VERIFY_PARALLEL = 3;

type Page = { path: string; content: string };

/**
 * The check pass: fresh agents, one per small batch of the pages this run wrote, check each claim
 * against the code and correct what the code does not support. It never fails the run; a checker
 * that stops keeps the corrections it wrote.
 */
async function verify(
  provider: Provider,
  rt: ToolRuntime,
): Promise<{ notes: string; usage: Usage; turns: number } | undefined> {
  const pages: Page[] = [];
  for (const path of rt.originals.keys()) {
    const abs = join(rt.cwd, path);
    if (path.endsWith(".md") && path !== TODO_PATH && existsSync(abs))
      pages.push({ path, content: await Bun.file(abs).text() });
  }
  if (!pages.length) return undefined;
  const batches = toBatches(pages);
  console.log(`\nverify: checking ${pages.length} page(s) in ${batches.length} batch(es)`);

  const total = { notes: [] as string[], usage: { input: 0, output: 0, cached: 0 }, turns: 0 };
  const queue = [...batches];
  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      const r = await checkBatch(provider, rt, batch);
      total.usage = sum(total.usage, r.usage);
      total.turns += r.turns;
      // One list item per line: GitHub joins plain lines into one paragraph.
      for (const line of r.notes.split("\n").map((l) => l.trim()))
        if (line) total.notes.push(line.startsWith("- ") ? line : `- ${line}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(VERIFY_PARALLEL, batches.length) }, worker));
  console.log(`verify: done: ${usageLine(total.usage)}`);
  return { notes: total.notes.join("\n"), usage: total.usage, turns: total.turns };
}

/** One checker with its own runtime: its finish result and its writes stay apart from the others. */
async function checkBatch(provider: Provider, rt: ToolRuntime, batch: Page[]) {
  const own: ToolRuntime = {
    ...rt,
    originals: new Map(),
    writable: new Set(batch.map((p) => p.path)),
    finished: undefined,
  };
  let r: { notes: string; usage: Usage; turns: number };
  try {
    const a = await runAgent({
      agent: VERIFY_AGENT,
      provider,
      rt: own,
      userMessage: buildVerifyMessage(batch),
    });
    r = { notes: a.result.notes, usage: a.usage, turns: a.turns };
  } catch (e) {
    console.warn(`verify stopped: ${flat((e instanceof Error && e.message) || String(e))}`);
    r = {
      notes: "",
      usage: e instanceof AgentError ? e.usage : { input: 0, output: 0, cached: 0 },
      turns: 0,
    };
  }
  return r;
}

/** Batches of up to VERIFY_BATCH pages, balanced by size: the largest page goes to the lightest batch. */
function toBatches(pages: Page[]): Page[][] {
  const batches: Page[][] = Array.from(
    { length: Math.ceil(pages.length / VERIFY_BATCH) },
    () => [],
  );
  const size = (b: Page[]) => b.reduce((n, p) => n + p.content.length, 0);
  for (const p of [...pages].sort((a, b) => b.content.length - a.content.length)) {
    const open = batches.filter((b) => b.length < VERIFY_BATCH);
    open.sort((a, b) => size(a) - size(b))[0]?.push(p);
  }
  return batches;
}

const sum = (a: Usage | undefined, b: Usage): Usage => ({
  input: (a?.input ?? 0) + b.input,
  output: (a?.output ?? 0) + b.output,
  cached: (a?.cached ?? 0) + b.cached,
});

/** Root files one per line, then each folder (two levels) with its file count. Capped. */
function fileTree(paths: Iterable<string>): string {
  const roots: string[] = [];
  const folders = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split("/");
    if (parts.length === 1) roots.push(p);
    else {
      const key = parts.slice(0, Math.min(2, parts.length - 1)).join("/");
      folders.set(key, (folders.get(key) ?? 0) + 1);
    }
  }
  const lines = [
    ...roots.sort().slice(0, 40),
    ...[...folders.entries()].sort().map(([dir, count]) => `${dir}/ (${count} files)`),
  ];
  return lines.length ? lines.slice(0, 300).join("\n") : "(no files)";
}

/** The body of the todo page, or undefined when there is none. Same check as read_file: no symlinks. */
async function todoBody(cwd: string): Promise<string | undefined> {
  const abs = join(cwd, TODO_PATH);
  if (!existsSync(abs) || !readableFile(cwd, TODO_PATH)) return undefined;
  return splitFrontmatter(await Bun.file(abs).text())?.body.trim() || undefined;
}

/** Items left in the todo page; removes the page when the model wrote it this run and it lists nothing. */
async function todoLeft(rt: ToolRuntime): Promise<number> {
  const body = await todoBody(rt.cwd);
  // Bullets or a numbered list: the model may write either.
  const items = body?.split("\n").filter((l) => /^\s*([-*+]|\d+[.)])\s+\S/.test(l)).length ?? 0;
  if (items === 0 && rt.originals.has(TODO_PATH)) rmSync(join(rt.cwd, TODO_PATH), { force: true });
  return items;
}

function usageLine(u: { input: number; output: number; cached: number }): string {
  return `${n(u.input)} input tokens (${n(u.cached)} from cache), ${n(u.output)} output tokens`;
}
