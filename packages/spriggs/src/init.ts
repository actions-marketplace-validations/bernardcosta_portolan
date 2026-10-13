import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { INIT_AGENT } from "./agent/agents";
import { buildInitMessage, TODO_PATH } from "./agent/init-prompt";
import { AgentError, runAgent } from "./agent/loop";
import { resolveProvider } from "./agent/model";
import type { Usage } from "./agent/providers/types";
import { createRuntime } from "./agent/tools";
import { splitFrontmatter } from "./docs/frontmatter";
import { loadPortolanConfig } from "./docs/portolan";
import { docsIndex } from "./docs/tree";
import { enforce } from "./enforce";
import { git } from "./git";
import { renderInitReport } from "./report";

const n = (x: number) => x.toLocaleString("en-US");

/** Exit code when the run stopped before `finish`: the pages written stay, but the set is not complete. */
export const STOPPED_EARLY = 3;

/**
 * Cold start: the init agent explores the repository and writes docs/ in the working tree.
 * Nothing is committed; the author reviews the result and opens the pull request.
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
  console.log(`init: ${provider.model}, ${index.length} existing docs`);

  let notes = "";
  let stopped: string | undefined;
  let usage: Usage | undefined;
  let turns: number | undefined;
  try {
    const agent = await runAgent({
      agent: INIT_AGENT,
      provider,
      rt,
      userMessage: buildInitMessage({ name: config?.name, index, tree: fileTree(rt.readable) }),
    });
    notes = agent.result.notes;
    usage = agent.usage;
    turns = agent.turns;
    console.log(`done in ${agent.turns} turns: ${usageLine(agent.usage)}`);
  } catch (e) {
    // The budget, the context window or the model gave out. The pages written so far stay;
    // the todo page is the honest list of what is left.
    stopped = (e as Error).message;
    if (e instanceof AgentError) usage = e.usage;
    console.warn(
      `stopped early: ${stopped}${usage ? `; ${usageLine(usage)}` : ""}. Keeping the pages written so far.`,
    );
  }

  const check = await enforce(rt, { strictTree: false, maxLines: Number.POSITIVE_INFINITY });
  if (!check.ok) {
    console.error(`check failed: ${check.reason}. The files are left in place for you to review.`);
    return 1;
  }

  const left = await todoLeft(cwd);
  const written = check.written.filter((p) => p !== TODO_PATH || left > 0);
  // The action takes the text between the two marker lines as the body of the pull request.
  const report = renderInitReport({
    written,
    created: check.created,
    left,
    notes,
    ...(stopped === undefined ? {} : { stopped }),
    ...(usage ? { usage } : {}),
    model: provider.model,
    ...(turns ? { turns } : {}),
  });
  console.log(`\n--- init result ---\n${report}\n--- end ---`);
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

/** Items left in the todo page; removes the page when it lists nothing. */
async function todoLeft(cwd: string): Promise<number> {
  const abs = join(cwd, TODO_PATH);
  if (!existsSync(abs)) return 0;
  const body = splitFrontmatter(await Bun.file(abs).text())?.body ?? "";
  // Bullets or a numbered list: the model may write either.
  const items = body.split("\n").filter((l) => /^\s*([-*+]|\d+[.)])\s+\S/.test(l)).length;
  if (items === 0) rmSync(abs);
  return items;
}

function usageLine(u: { input: number; output: number; cached: number }): string {
  return `${n(u.input)} input tokens (${n(u.cached)} from cache), ${n(u.output)} output tokens`;
}
