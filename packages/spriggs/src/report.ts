import type { Verdict } from "./gate/decide";
import { SIZE_CAP_LINES } from "./gate/decide";
import type { Signals } from "./gate/signals";

export function verdictLine(v: Verdict, s: Signals): string {
  switch (v.outcome) {
    case "proceed":
      return `**proceed** — reason stated, diff readable (${s.linesChanged} lines in ${s.filesChanged} files)`;
    case "partial":
      return v.reason === "diff-too-large"
        ? `**partial** — reason stated, but ${s.linesChanged} changed lines is above the ${SIZE_CAP_LINES} line cap. Only the public surface would be checked.`
        : "**partial** — the diff is readable, but the description states no reason. Add a **Why** section to the description.";
    case "abstain":
      return `**abstain** — no reason in the description and ${s.linesChanged} changed lines is above the ${SIZE_CAP_LINES} line cap. Add a **Why** section, or split the change.`;
  }
}

const yes = (b: boolean) => (b ? "yes" : "no");

export function renderComment(s: Signals, v: Verdict): string {
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
    "## Spriggs",
    "",
    `Gate: ${verdictLine(v, s)}`,
    "",
    "| Signal | Value |",
    "| --- | --- |",
    ...rows.map(([k, val]) => `| ${k} | ${val} |`),
    "",
    "_Stage one only. Spriggs does not write docs yet._",
  ].join("\n");
}
