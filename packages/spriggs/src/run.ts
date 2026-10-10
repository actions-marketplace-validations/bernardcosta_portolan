import { runAgent } from "./agent/loop";
import { resolveProvider } from "./agent/model";
import { buildUserMessage } from "./agent/prompt";
import type { Provider, Usage } from "./agent/providers/types";
import { createRuntime, revertWrites } from "./agent/tools";
import { loadPortolanConfig } from "./docs/portolan";
import { affectedDocs, docsIndex } from "./docs/tree";
import { enforce } from "./enforce";
import { type Entry, renderEntry, writeEntry } from "./entry/writer";
import type { Forge, Label, StatusState } from "./forge/types";
import { decide, skipReason } from "./gate/decide";
import { signals } from "./gate/signals";
import { diffByFile, git } from "./git";
import { type RunReport, renderComment, verdictLine } from "./report";

export type RunOptions = { cwd?: string; model?: string };

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
  console.log(`gate: ${verdict.outcome}${"reason" in verdict ? ` (${verdict.reason})` : ""}`);

  const blocking = process.env.SPRIGGS_BLOCKING === "true" || s.breaking;
  const report = async (label: Label, status: [StatusState, string], runReport?: RunReport) => {
    await forge.upsertComment(renderComment(s, verdict, runReport, staleCommits), marker);
    await forge.setLabel(label);
    await forge.setStatus(...status);
    return 0;
  };

  if (verdict.outcome === "abstain") {
    const plain = verdictLine(verdict, s).replace(/\*\*/g, "");
    return report(
      "docs:needs-input",
      blocking ? ["failure", "needs input: add a Why section"] : ["success", plain],
    );
  }

  let provider: Provider;
  try {
    provider = resolveProvider(opts.model);
  } catch (e) {
    return report("docs:needs-input", ["failure", "Spriggs is not configured"], {
      kind: "failed",
      reason: `Configuration error: ${(e as Error).message}.`,
    });
  }

  const changedPaths = ctx.files.map((f) => f.path);
  const rt = createRuntime(cwd, diffByFile(ctx.diffRevisions, cwd), changedPaths);
  const fail = async (reason: string, extra: { usage?: Usage } = {}) => {
    await revertWrites(rt);
    console.error(`failed: ${reason}`);
    return report("docs:needs-input", ["failure", reason.slice(0, 140)], {
      kind: "failed",
      reason,
      ...extra,
      model: provider.model,
    });
  };

  const index = await docsIndex(cwd);
  let agent: Awaited<ReturnType<typeof runAgent>>;
  try {
    const userMessage = buildUserMessage({
      signals: s,
      verdict,
      title: ctx.pr?.title ?? ctx.head.subject,
      body: ctx.pr?.body ?? "",
      commits: ctx.commits,
      ...(staleCommits ? { staleCommits } : {}),
      files: ctx.files,
      diffs: rt.diffs,
      index,
      affected: affectedDocs(index, changedPaths),
    });
    agent = await runAgent({ provider, rt, userMessage });
  } catch (e) {
    return fail(`The agent run failed: ${(e as Error).message}`);
  }
  const { result, usage, turns } = agent;

  // The tree check only in CI: a local working copy has the author's own uncommitted changes.
  const check = await enforce(rt, { strictTree: ctx.event !== undefined });
  if (!check.ok) return fail(`Post-run check failed: ${check.reason}`, { usage });

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
      coverage: verdict.outcome === "partial" ? "partial" : "full",
      ...(verdict.outcome === "partial" ? { reason: verdict.reason } : {}),
      docs: result.docs.filter((d) => check.written.includes(d) || index.some((i) => i.path === d)),
      body: result.body,
    };
    try {
      if (ctx.event) {
        entryPath = await writeEntry(cwd, entry);
      } else {
        // No pull request number in --local mode: show the entry, do not write a `pr: 0` file.
        console.log(
          `\n--- entry (not written in --local mode) ---\n${renderEntry(entry)}--- end entry ---`,
        );
        entryPath = "(printed above; written only in CI)";
      }
    } catch (e) {
      return fail(`Could not write the change entry: ${(e as Error).message}`, { usage });
    }
  }

  const base = { usage, model: provider.model, turns, notes: result.notes };
  if (check.written.length === 0 && !entryPath) {
    return report("docs:none", ["success", "no docs change needed"], { kind: "none", ...base });
  }

  const pushed = await forge.commitAndPush(`docs: ${oneLine(result.title)}`);
  if (pushed === "superseded") {
    console.log("superseded: the branch moved during the run");
    return 0;
  }
  const label: Label = verdict.outcome === "partial" ? "docs:partial" : "docs:done";
  const runReport: RunReport = {
    kind: "docs",
    written: check.written,
    ...(entryPath ? { entry: entryPath } : {}),
    ...base,
  };
  return report(label, ["success", verdictLine(verdict, s).replace(/\*\*/g, "")], runReport);
}

/** Commit titles are model output: one line, no control characters, at most 72 characters. */
function oneLine(title: string): string {
  const clean = title
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 72 ? `${clean.slice(0, 69).trimEnd()}...` : clean;
}
