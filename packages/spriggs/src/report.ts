import type { Usage } from "./agent/providers/types";
import type { Verdict } from "./gate/decide";
import { SIZE_CAP_LINES } from "./gate/decide";
import type { Signals } from "./gate/signals";

export function verdictLine(v: Verdict, s: Signals): string {
  switch (v.outcome) {
    case "proceed":
      return `**proceed** — reason stated, diff readable (${s.linesChanged} lines in ${s.filesChanged} files)`;
    case "partial":
      return v.reason === "diff-too-large"
        ? `**partial** — reason stated, but ${s.linesChanged} changed lines is above the ${SIZE_CAP_LINES} line cap. Only the public surface was checked.`
        : "**partial** — the diff is readable, but the description states no reason. Add a **Why** section to the description.";
    case "abstain":
      return `**abstain** — no reason in the description and ${s.linesChanged} changed lines is above the ${SIZE_CAP_LINES} line cap. Add a **Why** section, or split the change.`;
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
    ["Conventional Commits type", s.conventionalType ?? "none"],
    ["Kind", s.kind ?? "undecided"],
    ["Breaking", yes(s.breaking)],
    ["Issues", s.issueIds.length ? s.issueIds.join(", ") : "none"],
    ["Changed", `${s.filesChanged} files, ${s.linesChanged} lines`],
    [
      "Touches",
      [s.touchesApi && "api", s.touchesSchema && "schema", s.touchesConfig && "config"]
        .filter(Boolean)
        .join(", ") || "none",
    ],
  ];
  return [
    "## Spriggs: documentation harness report",
    "",
    "Spriggs reads each pull request, decides whether it has enough information to update `/docs`, and then updates them.",
    "",
    `Gate: ${verdictLine(v, s)}`,
    "",
    ...(staleCommits
      ? [
          `> **Description unchanged** since ${staleCommits} newer commit(s). Check that the Why still holds.`,
          "",
        ]
      : []),
    ...(run ? [...renderRun(run), ""] : []),
    "<details><summary>Gate signals</summary>",
    "",
    "| Signal | Value |",
    "| --- | --- |",
    ...rows.map(([k, val]) => `| ${k} | ${val} |`),
    "",
    "</details>",
  ].join("\n");
}

function renderRun(run: RunReport): string[] {
  const usage = (u: Usage | undefined, model: string | undefined, turns?: number) =>
    u
      ? `_${model ?? "model"}: ${u.input.toLocaleString()} input (${u.cached.toLocaleString()} cached) + ${u.output.toLocaleString()} output tokens${turns ? `, ${turns} turns` : ""}._`
      : "";
  switch (run.kind) {
    case "docs":
      return [
        run.written.length
          ? "**Docs updated.** Review the `docs:` commit on this branch."
          : "**No doc edits needed.** Only the change entry was written.",
        "",
        ...run.written.map((p) => `- \`${p}\``),
        ...(run.entry ? [`- \`${run.entry}\` (change entry)`] : []),
        ...(run.notes ? ["", `Notes from the run: ${run.notes}`] : []),
        "",
        usage(run.usage, run.model, run.turns),
      ];
    case "none":
      return [
        "**No docs change needed.** The run found nothing in `docs/` that this change contradicts.",
        ...(run.notes ? ["", `Notes from the run: ${run.notes}`] : []),
        "",
        usage(run.usage, run.model, run.turns),
      ];
    case "failed":
      return [
        `**Spriggs could not update the docs.** ${run.reason}`,
        "",
        "Nothing was committed. Fix the cause and push, or edit the description to rerun.",
        ...(run.usage ? ["", usage(run.usage, run.model)] : []),
      ];
  }
}
