import { type AgentResult, LARGE_BUDGET, runAgent, SMALL_BUDGET } from "./agent/loop";
import { resolveProvider, resolveTriageProvider } from "./agent/model";
import { buildUserMessage } from "./agent/prompt";
import type { Provider, Usage } from "./agent/providers/types";
import { createRuntime, revertWrites } from "./agent/tools";
import { buildTriageMessage, type Plan, runTriage } from "./agent/triage";
import { loadPortolanConfig } from "./docs/portolan";
import { affectedDocs, docsIndex } from "./docs/tree";
import { enforce } from "./enforce";
import { type Entry, renderEntry, writeEntry } from "./entry/writer";
import type { Forge, Label, StatusState } from "./forge/types";
import { decide, skipReason } from "./gate/decide";
import { isGenerated, signals } from "./gate/signals";
import { diffByFile, git } from "./git";
import { type Coverage, type RunReport, renderComment, statusLine } from "./report";

export type RunOptions = { cwd?: string; model?: string };

/** context -> skip rules -> stage one -> decide -> (triage) -> agent -> enforce -> entry -> commit -> report. */
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
  const report = async (label: Label, status: [StatusState, string], runReport?: RunReport) => {
    await forge.upsertComment(renderComment(s, verdict, label, runReport, staleCommits), marker);
    await forge.setLabel(label);
    await forge.setStatus(...status);
    return 0;
  };

  if (verdict.outcome === "abstain") {
    return report("docs:needs-input", [blocking ? "failure" : "success", statusLine(verdict, s)]);
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
  const usage: Usage = { input: 0, output: 0, cached: 0 };
  const add = (u: Usage) => {
    usage.input += u.input;
    usage.output += u.output;
    usage.cached += u.cached;
  };
  const fail = async (reason: string) => {
    await revertWrites(rt);
    console.error(`failed: ${reason}`);
    return report("docs:needs-input", ["failure", reason.slice(0, 140)], {
      kind: "failed",
      reason,
      ...(usage.input ? { usage } : {}),
      model: provider.model,
    });
  };

  const index = await docsIndex(cwd);
  const title = ctx.pr?.title ?? ctx.head.subject;
  const body = ctx.pr?.body ?? "";
  const large = verdict.tier === "large";

  // Phase one, large changes only: decide what to read, with evidence.
  let plan: Plan | undefined;
  if (large) {
    try {
      const triage = await runTriage({
        provider: resolveTriageProvider(provider),
        message: buildTriageMessage({
          title,
          body,
          commits: ctx.commits,
          files: ctx.files,
          diffs: rt.diffs,
          index,
        }),
        files: ctx.files,
      });
      plan = triage.plan;
      add(triage.usage);
      if (triage.fallback) console.log("triage gave no plan; reading every file");
      for (const f of plan.files) console.log(`  ${f.read.padEnd(4)} ${f.path} — ${f.why}`);
    } catch (e) {
      return fail(`The triage call failed: ${(e as Error).message}`);
    }
  }

  // Phase two: read, write, finish.
  let agent: AgentResult;
  try {
    const message = buildUserMessage({
      signals: s,
      verdict,
      title,
      body,
      commits: ctx.commits,
      ...(staleCommits ? { staleCommits } : {}),
      files: ctx.files,
      diffs: rt.diffs,
      index,
      affected: affectedDocs(index, changedPaths),
      ...(plan ? { plan } : {}),
    });
    agent = await runAgent({
      provider,
      rt,
      userMessage: message.text,
      inlineShown: message.inlineShown,
      ...(plan ? { plan } : {}),
      newFiles: [...rt.diffs].filter(([, chunk]) => /^new file mode/m.test(chunk)).map(([p]) => p),
      budget: large ? LARGE_BUDGET : SMALL_BUDGET,
    });
  } catch (e) {
    return fail(`The agent run failed: ${(e as Error).message}`);
  }
  add(agent.usage);
  const { result, turns } = agent;

  const counted = changedPaths.filter((p) => !isGenerated(p));
  const required = plan ? plan.files.filter((f) => f.read !== "skip").map((f) => f.path) : counted;
  const coverage: Coverage = {
    changed: counted.length,
    read: counted.filter((p) => agent.seen.has(p)).length,
    skipped: plan?.files.filter((f) => f.read === "skip") ?? [],
    missed: required.filter((p) => !agent.seen.has(p)),
    triaged: plan !== undefined,
  };
  console.log(
    `coverage: read ${coverage.read}/${coverage.changed}, missed ${coverage.missed.length}`,
  );

  // The tree check only in CI: a local working copy has the author's own uncommitted changes.
  const check = await enforce(rt, { strictTree: ctx.event !== undefined });
  if (!check.ok) return fail(`Post-run check failed: ${check.reason}`);

  // Partial when the author gave no reason, or when planned files went unread before the budget ran out.
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
      return fail(`Could not write the change entry: ${(e as Error).message}`);
    }
  }

  const base = { usage, model: provider.model, turns, notes: result.notes, coverage };
  if (check.written.length === 0 && !entryPath) {
    const label: Label = partial ? "docs:partial" : "docs:none";
    return report(label, ["success", statusLine(verdict, s, coverage.missed.length)], {
      kind: "none",
      ...base,
    });
  }

  const pushed = await forge.commitAndPush(`docs: ${oneLine(result.title)}`);
  if (pushed === "superseded") {
    console.log("superseded: the branch moved during the run");
    return 0;
  }
  const label: Label = partial ? "docs:partial" : "docs:done";
  const runReport: RunReport = {
    kind: "docs",
    written: check.written,
    ...(entryPath ? { entry: entryPath } : {}),
    ...base,
  };
  return report(label, ["success", statusLine(verdict, s, coverage.missed.length)], runReport);
}

/** Commit titles are model output: one line, no control characters, at most 72 characters. */
function oneLine(title: string): string {
  const clean = title
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 72 ? `${clean.slice(0, 69).trimEnd()}...` : clean;
}
