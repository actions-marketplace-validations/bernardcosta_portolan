import type { Usage } from "./agent/providers/types";
import type { Verdict } from "./gate/decide";
import { SIZE_CAP_LINES } from "./gate/decide";
import type { Signals } from "./gate/signals";

// The sticky comment. Written as a colleague would write it: first person, plain words, short sentences.

const n = (x: number) => x.toLocaleString("en-US");

export function verdictLine(v: Verdict, s: Signals): string {
  const size = `${n(s.linesChanged)} lines in ${n(s.filesChanged)} files`;
  switch (v.outcome) {
    case "proceed":
      return `**Gate: go.** The description says why, and the change is small enough to check in full (${size}).`;
    case "partial":
      return v.reason === "diff-too-large"
        ? `**Gate: partial.** The description says why, but this change is big (${size}; I check up to ${n(SIZE_CAP_LINES)} lines in full). I checked the public surface only: overview, setup, API and config. I left the rest alone.`
        : "**Gate: partial.** The change is small enough, but the description does not say why it is made. I updated what the code shows and did not guess the intent. Add a **Why** section to the description and I will run again.";
    case "abstain":
      return `**Gate: stopped.** The description does not say why, and the change is too big to check without that (${size}). Add a **Why** section, or split the change, and I will run again.`;
  }
}

/** The one-line form for the commit status: 140 characters max, no markdown. */
export function statusLine(v: Verdict, s: Signals): string {
  switch (v.outcome) {
    case "proceed":
      return `go: reason stated, ${n(s.linesChanged)} lines checked in full`;
    case "partial":
      return v.reason === "diff-too-large"
        ? `partial: ${n(s.linesChanged)} lines is above the ${n(SIZE_CAP_LINES)} line cap, public surface checked only`
        : "partial: no reason in the description, add a Why section";
    case "abstain":
      return "stopped: no reason and the change is too big, add a Why section";
  }
}

const yes = (b: boolean) => (b ? "yes" : "no");

export type RunReport =
  | {
      kind: "docs";
      written: string[];
      entry?: string;
      notes: string;
      usage: Usage;
      model: string;
      turns: number;
    }
  | { kind: "none"; notes: string; usage: Usage; model: string; turns: number }
  | { kind: "failed"; reason: string; usage?: Usage; model?: string };

export function renderComment(
  s: Signals,
  v: Verdict,
  run?: RunReport,
  staleCommits?: number,
): string {
  const rows: [string, string][] = [
    ["Description", yes(s.descriptionPresent)],
    ["Why section", yes(s.hasWhy)],
    ["Commit type", s.conventionalType ?? "none"],
    ["Kind of change", s.kind ?? "not decided yet"],
    ["Breaking", yes(s.breaking)],
    ["Linked issues", s.issueIds.length ? s.issueIds.join(", ") : "none"],
    ["Size", `${n(s.filesChanged)} files, ${n(s.linesChanged)} lines`],
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
    verdictLine(v, s),
    "",
    ...(staleCommits
      ? [
          `> **Heads up:** the description has not changed since ${n(staleCommits)} newer commit${staleCommits === 1 ? "" : "s"}. Does the reason still hold?`,
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
  const usage = (u: Usage | undefined, model: string | undefined, turns?: number) =>
    u
      ? `_${model ?? "model"} · ${n(u.input)} input tokens (${n(u.cached)} from cache) · ${n(u.output)} output tokens${turns ? ` · ${turns} turn${turns === 1 ? "" : "s"}` : ""}_`
      : "";
  switch (run.kind) {
    case "docs":
      return [
        run.written.length
          ? "**I updated the docs.** The `docs:` commit on this branch has these changes:"
          : "**The docs already match.** I only wrote the change entry:",
        "",
        ...run.written.map((p) => `- \`${p}\``),
        ...(run.entry ? [`- \`${run.entry}\` (the change entry)`] : []),
        ...(run.notes ? ["", `A note from the run: ${run.notes}`] : []),
        "",
        usage(run.usage, run.model, run.turns),
      ];
    case "none":
      return [
        "**Nothing to change.** The docs already match this change, and it needs no entry in the change feed.",
        ...(run.notes ? ["", `A note from the run: ${run.notes}`] : []),
        "",
        usage(run.usage, run.model, run.turns),
      ];
    case "failed":
      return [
        `**I could not update the docs.** ${run.reason}`,
        "",
        "I committed nothing. Fix the cause and push, or edit the description, and I will run again.",
        ...(run.usage ? ["", usage(run.usage, run.model)] : []),
      ];
  }
}
