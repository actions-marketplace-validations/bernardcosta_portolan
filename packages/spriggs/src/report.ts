import type { Usage } from "./agent/providers/types";
import type { Label } from "./forge/types";
import type { Verdict } from "./gate/decide";
import { maxLines } from "./gate/decide";
import type { Signals } from "./gate/signals";

// The sticky comment. Written as a colleague would write it: first person, plain words, short sentences.

const n = (x: number) => x.toLocaleString("en-US");

/** What the model saw of the change. Reported, never assumed. */
export type Coverage = {
  /** Changed files that count (generated files excluded). */
  changed: number;
  /** Of those, the files the model saw inline or read with a tool. */
  read: number;
  /** Changed files that were not shown inline and the model never read. */
  missed: string[];
};

export type RunReport =
  | {
      kind: "docs";
      written: string[];
      created: string[];
      entry?: string;
      notes: string;
      usage: Usage;
      model: string;
      turns: number;
      coverage: Coverage;
    }
  | { kind: "none"; notes: string; usage: Usage; model: string; turns: number; coverage: Coverage }
  | { kind: "failed"; reason: string; usage?: Usage; model?: string };

/** The first line of the comment: the label people see, then what it means for this change. */
export function leadLine(label: Label, v: Verdict, s: Signals, run?: RunReport): string {
  const size = `${n(s.linesChanged)} lines in ${n(s.filesChanged)} files`;
  if (run?.kind === "failed") {
    return `**docs:needs-input** — I could not update the docs. ${run.reason} I committed nothing. Fix the cause and push, or edit the description, and I will run again.`;
  }
  if (v.outcome === "abstain") {
    return v.reason === "too-large"
      ? `**docs:needs-input** — This change is ${size}, above the ${n(maxLines())} lines I can check in one run. Split the pull request, or raise \`SPRIGGS_MAX_LINES\` for this repository.`
      : `**docs:needs-input** — I did not update the docs. The description does not say why this change is made, and the change is too big (${size}) to check without that. Add a **Why** section, or split the change, and I will run again.`;
  }
  const cov = run?.coverage;
  const readCount = cov ? `I read ${n(cov.read)} of ${n(cov.changed)} changed files` : "";
  if (v.outcome === "partial") {
    const extra = cov?.missed.length
      ? ` I also finished without reading ${n(cov.missed.length)} changed files; they are listed below.`
      : "";
    return `**docs:partial** — I checked only part of this change. The description does not say why it is made, so I updated what the code shows and did not guess the intent. Add a **Why** section to the description and I will run again.${extra}`;
  }
  if (label === "docs:partial") {
    return `**docs:partial** — ${readCount} (${size}). The files I did not read are listed below; their changes may be missing from the docs.`;
  }
  if (label === "docs:none") {
    return `**docs:none** — I checked this whole change (${size}). The docs already match it, and it needs no entry in the change feed.`;
  }
  return run?.kind === "docs" && run.written.length === 0
    ? `**docs:done** — I checked this whole change (${size}). The docs already matched it; I wrote the change entry.`
    : `**docs:done** — I checked this whole change (${size}) and the docs now match it.`;
}

/** The one-line form for the commit status: 140 characters max, no markdown. */
export function statusLine(v: Verdict, s: Signals, missed = 0): string {
  switch (v.outcome) {
    case "proceed":
      return missed
        ? `partial: ${missed} changed files not read`
        : `done: reason stated, ${n(s.linesChanged)} lines checked`;
    case "partial":
      return "partial: no reason in the description, add a Why section";
    case "abstain":
      return v.reason === "too-large"
        ? `stopped: ${n(s.linesChanged)} lines is above the ${n(maxLines())} line limit, split the change`
        : "stopped: no reason and the change is too big, add a Why section";
  }
}

const yes = (b: boolean) => (b ? "yes" : "no");

/** The small line under a report: model, tokens and turns. */
function usageLine(u: Usage, model: string | undefined, turns?: number): string {
  return `_${model ?? "model"} · ${n(u.input)} input tokens (${n(u.cached)} from cache) · ${n(u.output)} output tokens${turns ? ` · ${turns} turn${turns === 1 ? "" : "s"}` : ""}_`;
}

/** The body of the pull request that a cold start opens; locally, the text printed at the end. */
export function renderInitReport(r: {
  written: string[];
  created: string[];
  /** Pages still listed in docs/todo.md. */
  left: number;
  notes: string;
  /** Why the run stopped before `finish`, when it did. */
  stopped?: string;
  usage?: Usage;
  model: string;
  turns?: number;
}): string {
  return [
    "## Spriggs: cold start report",
    "",
    "I explored this repository and wrote a first set of docs. Review them like any other change: the pages are a first draft from the code, not a record of intent.",
    "",
    ...(r.stopped
      ? [`> **Stopped early:** ${r.stopped}. I kept the pages I had written before that.`, ""]
      : []),
    ...(r.written.length
      ? r.written.map((p) => `- \`${p}\`${r.created.includes(p) ? " (new page)" : ""}`)
      : ["I wrote no pages."]),
    "",
    r.left
      ? `**${n(r.left)} page${r.left === 1 ? "" : "s"} planned but not written.** The list is in \`docs/todo.md\`.`
      : "I wrote every page I planned.",
    ...(r.notes ? ["", `A note from the run: ${r.notes}`] : []),
    ...(r.usage ? ["", usageLine(r.usage, r.model, r.turns)] : []),
  ].join("\n");
}

export function renderComment(
  s: Signals,
  v: Verdict,
  label: Label,
  run?: RunReport,
  staleCommits?: number,
  /** The repository had no doc pages when the run started. */
  noDocs?: boolean,
): string {
  const rows: [string, string][] = [
    ["Description", yes(s.descriptionPresent)],
    ["Why section", yes(s.hasWhy)],
    ["Commit type", s.conventionalType ?? "none"],
    ["Kind of change", s.kind ?? "not decided yet"],
    ["Breaking", yes(s.breaking)],
    ["Linked issues", s.issueIds.length ? s.issueIds.join(", ") : "none"],
    ["Size", `${n(s.filesChanged)} files, ${n(s.linesChanged)} lines (limit ${n(maxLines())})`],
    [
      "Touches",
      [s.touchesApi && "API", s.touchesSchema && "schema", s.touchesConfig && "config"]
        .filter(Boolean)
        .join(", ") || "none of API, schema or config",
    ],
  ];
  return [
    "## Spriggs: documentation harness report",
    "",
    "I read this pull request and checked whether `docs/` still matches the code. Here is what I found.",
    "",
    leadLine(label, v, s, run),
    "",
    ...(staleCommits
      ? [
          `> **Heads up:** the description has not changed since ${n(staleCommits)} newer commit${staleCommits === 1 ? "" : "s"}. Does the reason still hold?`,
          "",
        ]
      : []),
    ...(noDocs
      ? [
          "> **No docs yet:** this repository had no doc pages when I started, and a pull request run only covers one change. For a first set of docs for the whole repository, run the cold start: start the Spriggs workflow by hand from the Actions tab, or run `spriggs init` locally.",
          "",
        ]
      : []),
    ...(run ? [...renderRun(run), ""] : []),
    "<details><summary>What I saw</summary>",
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([k, val]) => `| ${k} | ${val} |`),
    "",
    "</details>",
  ].join("\n");
}

function renderRun(run: RunReport): string[] {
  if (run.kind === "failed") return run.usage ? [usageLine(run.usage, run.model)] : [];

  const note = run.notes ? [`A note from the run: ${run.notes}`, ""] : [];
  const missed = run.coverage.missed.length
    ? ["**Not read:**", "", ...run.coverage.missed.map((p) => `- \`${p}\``), ""]
    : [];
  const files =
    run.kind === "docs" && (run.written.length || run.entry)
      ? [
          "The `docs:` commit on this branch has these changes:",
          "",
          ...run.written.map((p) => `- \`${p}\`${run.created.includes(p) ? " (new page)" : ""}`),
          ...(run.entry ? [`- \`${run.entry}\` (the change entry)`] : []),
          "",
        ]
      : [];
  return [...files, ...note, ...missed, usageLine(run.usage, run.model, run.turns)];
}
