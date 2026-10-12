import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { INIT_AGENT } from "./agent/agents";
import { buildInitMessage, TODO_PATH } from "./agent/init-prompt";
import { AgentError, runAgent } from "./agent/loop";
import { resolveProvider } from "./agent/model";
import { createRuntime } from "./agent/tools";
import { splitFrontmatter } from "./docs/frontmatter";
import { loadPortolanConfig } from "./docs/portolan";
import { docsIndex } from "./docs/tree";
import { enforce } from "./enforce";
import { git } from "./git";

const n = (x: number) => x.toLocaleString("en-US");

/**
 * Cold start: the init agent explores the repository and writes docs/ in the working tree.
 * Nothing is committed; the author reviews the result and opens the pull request.
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
  try {
    const agent = await runAgent({
      agent: INIT_AGENT,
      provider,
      rt,
      userMessage: buildInitMessage({ name: config?.name, index, tree: fileTree(cwd) }),
    });
    notes = agent.result.notes;
    console.log(`done in ${agent.turns} turns: ${usageLine(agent.usage)}`);
  } catch (e) {
    // The budget, the context window or the model gave out. The pages written so far stay;
    // the todo page is the honest list of what is left.
    const usage = e instanceof AgentError ? `; ${usageLine(e.usage)}` : "";
    console.warn(
      `stopped early: ${(e as Error).message}${usage}. Keeping the pages written so far.`,
    );
  }

  const check = await enforce(rt, { strictTree: false, maxLines: Number.POSITIVE_INFINITY });
  if (!check.ok) {
    console.error(`check failed: ${check.reason}. The files are left in place for you to review.`);
    return 1;
  }

  const left = await todoLeft(cwd);
  const written = check.written.filter((p) => p !== TODO_PATH || left > 0);
  console.log(
    `\n--- init result ---\n${
      written.length
        ? written.map((p) => `- ${p}${check.created.includes(p) ? " (new page)" : ""}`).join("\n")
        : "(no pages written)"
    }\n${left === 0 ? "Nothing left in the todo." : `${n(left)} page(s) left in ${TODO_PATH}.`}${
      notes ? `\nNote from the run: ${notes}` : ""
    }\nReview the changes in docs/, then commit them and open a pull request.\n--- end ---`,
  );
  return 0;
}

/** Root files one per line, then each folder (two levels) with its file count. Capped. */
function fileTree(cwd: string): string {
  const paths = git(["ls-files"], cwd).trim().split("\n").filter(Boolean);
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
  return lines.length ? lines.slice(0, 300).join("\n") : "(no tracked files)";
}

/** Items left in the todo page; removes the page when it lists nothing. */
async function todoLeft(cwd: string): Promise<number> {
  const abs = join(cwd, TODO_PATH);
  if (!existsSync(abs)) return 0;
  const body = splitFrontmatter(await Bun.file(abs).text())?.body ?? "";
  const items = body.split("\n").filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
  if (items === 0) rmSync(abs);
  return items;
}

function usageLine(u: { input: number; output: number; cached: number }): string {
  return `${n(u.input)} input tokens (${n(u.cached)} from cache), ${n(u.output)} output tokens`;
}
