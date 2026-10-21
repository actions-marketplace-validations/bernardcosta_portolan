import { existsSync } from "node:fs";
import { join } from "node:path";
import { docsAgent } from "./agent/agents";
import { type AgentResult, runAgent } from "./agent/loop";
import { resolveProvider } from "./agent/model";
import { buildUserMessage } from "./agent/prompt";
import { ContextWindowError, type Provider, type Usage } from "./agent/providers/types";
import { createRuntime, readableFile, revertWrites } from "./agent/tools";
import { deadLinks } from "./checks/links";
import { unreadFiles } from "./checks/unread";
import { validateDoc, validateEntry } from "./docs/frontmatter";
import { loadPortolanConfig } from "./docs/portolan";
import { affectedDocs, docsIndex } from "./docs/tree";
import { enforce } from "./enforce";
import { type Entry, renderEntry, writeEntry } from "./entry/writer";
import type { Debt, Forge, Label, StatusState } from "./forge/types";
import { decide, skipReason } from "./gate/decide";
import { isGenerated, signals } from "./gate/signals";
import { currentEntry, diffByFile, git } from "./git";
import { type Coverage, type RunReport, renderComment, statusLine } from "./report";
import { loadPages, sum, verify } from "./verify";

export type RunOptions = { cwd?: string; model?: string };

/** Merged pull requests with unchecked docs that one run catches up on. More than this is a job for the survey. */
const MAX_DEBT = 10;

/** context -> skip rules -> stage one -> decide -> agent -> enforce -> entry -> commit -> report. */
export async function run(forge: Forge, opts: RunOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const ctx = await forge.getContext();
  const { config, errors } = await loadPortolanConfig(cwd);
  for (const e of errors) console.warn(`warning: ${e}`);

  const s = signals(ctx, config);
  const skip = skipReason(ctx, s);
  if (skip) {
    console.log(`skip: ${skip}`);
    return 0;
  }

  // Drift: same description as the last run, but the head moved. Noted, never blocking.
  const marker = { bodyHash: Bun.hash(ctx.pr?.body ?? "").toString(16), headSha: ctx.head.sha };
  const prev = await forge.previousRun();
  let staleCommits: number | undefined;
  if (prev && prev.bodyHash === marker.bodyHash && prev.headSha !== ctx.head.sha) {
    try {
      staleCommits =
        Number(git(["rev-list", "--count", `${prev.headSha}..${ctx.head.sha}`], cwd)) || undefined;
    } catch {
      staleCommits = undefined; // force-push or unknown commit: nothing to count
    }
  }

  const verdict = decide(s);
  console.log(
    `gate: ${verdict.outcome}${"reason" in verdict ? ` (${verdict.reason})` : ""}${"tier" in verdict ? ` [${verdict.tier}]` : ""}`,
  );

  const blocking = process.env.SPRIGGS_BLOCKING === "true" || s.breaking;
  const index = await docsIndex(cwd);
  // No pages at all: the comment points to the survey.
  const noDocs = !index.some((d) => d.path.endsWith(".md"));
  const report = async (label: Label, status: [StatusState, string], runReport?: RunReport) => {
    await forge.upsertComment(
      renderComment(s, verdict, label, runReport, staleCommits, noDocs),
      marker,
    );
    await forge.setLabel(label);
    await forge.setStatus(...status);
    return 0;
  };

  // Docs already updated in this PR (the Spriggs skill, or by hand): no model run, no commit.
  let current: string | undefined;
  try {
    current = ctx.event ? currentEntry(ctx.base.sha, ctx.head.sha, cwd) : undefined;
  } catch (e) {
    console.warn(`warning: could not check for current docs: ${(e as Error).message}`);
  }
  if (current) {
    console.log(`current: ${current}`);
    const problems = await checkCurrent(
      cwd,
      current,
      ctx.files.map((f) => f.path),
    );
    const ok = problems.length === 0;
    return report(
      ok ? "docs:done" : "docs:needs-input",
      ok
        ? ["success", "done: docs updated in this pull request"]
        : ["failure", "stopped: the docs in this pull request have problems"],
      { kind: "current", entry: current, problems },
    );
  }

  if (verdict.outcome === "abstain") {
    return report("docs:needs-input", [blocking ? "failure" : "success", statusLine(verdict, s)]);
  }

  let provider: Provider;
  try {
    provider = resolveProvider(opts.model);
  } catch (e) {
    return report("docs:needs-input", ["failure", "Spriggs is not configured"], {
      kind: "failed",
      reason: "Configuration error:",
      error: (e as Error).message,
    });
  }

  const changedPaths = ctx.files.map((f) => f.path);
  const rt = createRuntime(cwd, diffByFile(ctx.diffRevisions, cwd), changedPaths);
  /** `error` is the raw error text: the comment shows it in a code block. */
  const fail = async (reason: string, usage?: Usage, error?: unknown) => {
    await revertWrites(rt);
    const text =
      error === undefined ? "" : (error instanceof Error && error.message) || String(error);
    console.error(`failed: ${reason}${text ? ` ${text}` : ""}`);
    return report("docs:needs-input", ["failure", `${reason} ${text}`.trim().slice(0, 140)], {
      kind: "failed",
      reason,
      ...(text ? { error: text } : {}),
      ...(usage ? { usage } : {}),
      model: provider.model,
    });
  };

  // Docs debt: merged pull requests whose docs were never fully updated. A lookup error never fails the run.
  let debt: Debt[] = [];
  let moreDebt = false;
  try {
    debt = await forge.docsDebt(MAX_DEBT + 1);
    moreDebt = debt.length > MAX_DEBT;
    debt = debt.slice(0, MAX_DEBT);
    if (debt.length) console.log(`debt: ${debt.map((d) => `#${d.number}`).join(", ")}`);
  } catch (e) {
    console.warn(`warning: could not list the docs debt: ${(e as Error).message}`);
  }

  // The pages whose covers touch the change: shown to the docs agent, and checked after it (drift).
  const affected = affectedDocs(index, changedPaths);
  let agent: AgentResult;
  try {
    const message = buildUserMessage({
      signals: s,
      verdict,
      title: ctx.pr?.title ?? ctx.head.subject,
      body: ctx.pr?.body ?? "",
      commits: ctx.commits,
      ...(staleCommits ? { staleCommits } : {}),
      files: ctx.files,
      diffs: rt.diffs,
      index,
      affected,
      debt,
    });
    agent = await runAgent({
      provider,
      rt,
      userMessage: message.text,
      inlineShown: message.inlineShown,
      checks: [unreadFiles(message.notShown), deadLinks("run")],
      agent: docsAgent(verdict.tier),
    });
  } catch (e) {
    if (e instanceof ContextWindowError) {
      return fail(
        `This change does not fit the context window of ${provider.model}. Use a model with a larger window, or split the pull request.`,
      );
    }
    return fail("The agent run failed:", undefined, e);
  }
  const { result } = agent;
  let { usage, turns } = agent;

  const counted = changedPaths.filter((p) => !isGenerated(p));
  const coverage: Coverage = {
    changed: counted.length,
    read: counted.filter((p) => agent.seen.has(p)).length,
    missed: counted.filter((p) => !agent.seen.has(p)),
  };
  console.log(`coverage: read ${coverage.read}/${coverage.changed}`);

  // The check pass: the pages written this run, then the affected pages. Its corrections join the docs commit.
  const pages = await loadPages(cwd, [...rt.originals.keys(), ...affected.map((d) => d.path)]);
  const verified = await verify(
    provider,
    rt,
    pages.map((p) => ({ ...p, written: rt.originals.has(p.path) })),
    counted,
  );
  if (verified) {
    usage = sum(usage, verified.usage);
    turns += verified.turns;
  }

  // The tree check only in CI: a local working copy has the author's own uncommitted changes.
  const check = await enforce(rt, { strictTree: ctx.event !== undefined });
  if (!check.ok) return fail(`Post-run check failed: ${check.reason}.`, usage);

  // Partial when the author gave no reason, or when changed files went unread before the budget ran out.
  const partial = verdict.outcome === "partial" || coverage.missed.length > 0;
  const reason =
    verdict.outcome === "partial"
      ? "reason-missing"
      : coverage.missed.length
        ? "diff-too-large"
        : undefined;

  // kind and breaking are mechanical where the commit type decides; the model fills the gaps.
  const kind =
    s.kind === "added" && result.kind === "changed"
      ? "changed"
      : (s.kind ?? (result.kind === "unknown" ? "changed" : result.kind));
  const needsEntry = kind !== "internal" || result.large_refactor;
  let entryPath: string | undefined;
  if (needsEntry) {
    const entry: Entry = {
      title: result.title,
      kind,
      breaking: s.breaking,
      pr: ctx.pr?.number ?? 0,
      coverage: partial ? "partial" : "full",
      ...(reason ? { reason } : {}),
      // The pages the model named, plus any page a checker corrected without the docs agent naming it.
      docs: [
        ...new Set([
          ...result.docs.filter(
            (d) => check.written.includes(d) || index.some((i) => i.path === d),
          ),
          ...check.written.filter((d) => d.endsWith(".md")),
        ]),
      ].filter((d) => !check.deleted.includes(d)),
      body: result.body,
    };
    try {
      if (ctx.event) {
        const added = git(
          [
            "diff",
            "--name-only",
            "-z",
            "--diff-filter=A",
            ...ctx.diffRevisions,
            "--",
            "docs/changes/",
          ],
          cwd,
        ).split("\0");
        entryPath = await writeEntry(cwd, entry, added);
      } else {
        // No pull request number in --local mode: show the entry, do not write a `pr: 0` file.
        console.log(
          `\n--- entry (not written in --local mode) ---\n${renderEntry(entry)}--- end entry ---`,
        );
        entryPath = "(printed above; written only in CI)";
      }
    } catch (e) {
      return fail("Could not write the change entry:", usage, e);
    }
  }

  const base = {
    usage,
    model: provider.model,
    turns,
    notes: result.notes,
    coverage,
    moreDebt,
    ...(verified ? { checked: verified.notes, checkedPages: verified.pages } : {}),
  };
  const status: [StatusState, string] = ["success", statusLine(verdict, s, coverage.missed.length)];
  // The debt is paid only by a full run; a partial run leaves it for the next one.
  const clearDebt = async (): Promise<number[] | undefined> => {
    if (partial || !debt.length) return undefined;
    const prs = debt.map((d) => d.number);
    try {
      await forge.clearDebt(prs);
      return prs;
    } catch (e) {
      console.warn(`warning: could not clear the docs debt: ${(e as Error).message}`);
      return undefined;
    }
  };
  if (check.written.length === 0 && !entryPath) {
    const caughtUp = await clearDebt();
    return report(partial ? "docs:partial" : "docs:none", status, {
      kind: "none",
      ...base,
      ...(caughtUp ? { caughtUp } : {}),
    });
  }

  let pushed: Awaited<ReturnType<Forge["commitAndPush"]>>;
  try {
    pushed = await forge.commitAndPush(`docs: ${oneLine(result.title)}`);
  } catch (e) {
    return fail("Could not push the docs commit:", usage, e);
  }
  if (pushed === "superseded") {
    console.log("superseded: the branch moved during the run");
    return 0;
  }
  // The marker names the head after the docs commit, so the next drift count excludes it.
  if (pushed === "pushed") marker.headSha = git(["rev-parse", "HEAD"], cwd).trim();
  const caughtUp = await clearDebt();
  const runReport: RunReport = {
    kind: "docs",
    ...(caughtUp ? { caughtUp } : {}),
    written: check.written,
    created: check.created,
    deleted: check.deleted,
    ...(entryPath ? { entry: entryPath } : {}),
    ...base,
  };
  return report(partial ? "docs:partial" : "docs:done", status, runReport);
}

/** The checks that need no model, on the entry and the doc pages this pull request changed. */
async function checkCurrent(cwd: string, entry: string, changed: string[]): Promise<string[]> {
  // Exists and is a plain file inside the repo: no symlink is read.
  const plain = (p: string) => existsSync(join(cwd, p)) && readableFile(cwd, p);
  const pages = changed.filter(
    (p) =>
      p.endsWith(".md") &&
      p.startsWith("docs/") &&
      !p.startsWith("docs/changes/") &&
      !p.startsWith("docs/api/") &&
      plain(p),
  );
  const problems = plain(entry)
    ? validateEntry(await Bun.file(join(cwd, entry)).text()).map((e) => `${entry}: ${e}`)
    : [`${entry}: missing or not a plain file`];
  for (const p of pages) {
    for (const e of validateDoc(await Bun.file(join(cwd, p)).text())) problems.push(`${p}: ${e}`);
  }
  // deadLinks("run") checks links from or to the pages in originals: here, the changed pages.
  const rt = createRuntime(cwd, new Map(), changed);
  for (const p of pages) rt.originals.set(p, null);
  return [...problems, ...deadLinks("run").run({ rt, seen: new Set() })];
}

/** Commit titles are model output: one line, no control characters, at most 72 characters. */
function oneLine(title: string): string {
  const clean = title
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 72 ? `${clean.slice(0, 69).trimEnd()}...` : clean;
}
