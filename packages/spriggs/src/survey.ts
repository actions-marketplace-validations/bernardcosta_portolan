import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SURVEY_AGENT } from "./agent/agents";
import { AgentError, runAgent } from "./agent/loop";
import { resolveProvider } from "./agent/model";
import type { Usage } from "./agent/providers/types";
import { buildSurveyMessage, TODO_PATH } from "./agent/survey-prompt";
import { createRuntime, readableFile, type ToolRuntime } from "./agent/tools";
import { deadLinks } from "./checks/links";
import { splitFrontmatter } from "./docs/frontmatter";
import { loadPortolanConfig } from "./docs/portolan";
import { docsIndex } from "./docs/tree";
import { enforce } from "./enforce";
import { git } from "./git";
import { flat, renderSurveyReport } from "./report";
import { loadPages, sum, usageLine, verify } from "./verify";

/** Exit code when the run stopped before `finish`: the pages written stay, but the set is not complete. */
export const STOPPED_EARLY = 3;

/**
 * Survey: the survey agent explores the repository and writes docs/ in the working tree.
 * Nothing is committed here: locally the author reviews the result and opens the pull request;
 * in CI the action does (scripts/open-survey-pr.sh).
 * Returns 0, 1 when the post-run check failed, or `STOPPED_EARLY`.
 */
export async function survey(opts: { cwd?: string; model?: string } = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const provider = resolveProvider(opts.model);
  const { config, errors } = await loadPortolanConfig(cwd);
  for (const e of errors) console.warn(`warning: ${e}`);
  const index = await docsIndex(cwd);
  // Untracked files are readable too: a developer may run the survey before the first commit.
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd)
    .trim()
    .split("\n")
    .filter(Boolean);
  const rt = createRuntime(cwd, new Map(), untracked);
  // The todo is the memory between runs: what the last run did not write or check.
  const todo = await todoBody(cwd);
  console.log(`survey: ${provider.model}, ${index.length} existing docs`);

  let notes = "";
  let checked = "";
  let stopped: string | undefined;
  let usage: Usage | undefined;
  let turns: number | undefined;
  try {
    const agent = await runAgent({
      agent: SURVEY_AGENT,
      provider,
      rt,
      checks: [deadLinks()],
      userMessage: buildSurveyMessage({
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
    // Check what this run wrote. The todo is a plan, not a claim about the code.
    const pages = await loadPages(
      cwd,
      [...rt.originals.keys()].filter((p) => p !== TODO_PATH),
    );
    const v = await verify(
      provider,
      rt,
      pages.map((p) => ({ ...p, written: true })),
    );
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
  const report = renderSurveyReport({
    written,
    created: check.created,
    deleted: check.deleted,
    left,
    removedTodo,
    notes,
    checked,
    stopped,
    usage,
    model: provider.model,
    turns,
  });
  console.log(`\n--- survey result ---\n${report}\n--- end ---`);
  console.log("Review the changes in docs/, then commit them and open a pull request.");
  return stopped === undefined ? 0 : STOPPED_EARLY;
}

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
