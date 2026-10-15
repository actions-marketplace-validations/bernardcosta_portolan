import type { Usage } from "./agent/providers/types";
import type { Label } from "./forge/types";
import type { Verdict } from "./gate/decide";
import { maxLines } from "./gate/decide";
import type { Signals } from "./gate/signals";

// The sticky comment and the cold start report. Written as a colleague would write it: first person, plain words, short sentences.

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

/** What a finished run reports about the docs debt of earlier merged pull requests. */
type DebtReport = {
  /** Merged pull requests this run checked and marked docs:done. */
  caughtUp?: number[];
  /** More debt than one run checks. */
  moreDebt?: boolean;
};

export type RunReport =
  | ({
      kind: "docs";
      written: string[];
      created: string[];
      entry?: string;
      notes: string;
      usage: Usage;
      model: string;
      turns: number;
      coverage: Coverage;
    } & DebtReport)
  | ({
      kind: "none";
      notes: string;
      usage: Usage;
      model: string;
      turns: number;
      coverage: Coverage;
    } & DebtReport)
  | { kind: "failed"; reason: string; error?: string; usage?: Usage; model?: string };

/** The first line of the comment: the label people see, then what it means for this change. */
export function leadLine(label: Label, v: Verdict, s: Signals, run?: RunReport): string {
  const size = `${n(s.linesChanged)} lines in ${n(s.filesChanged)} files`;
  if (run?.kind === "failed") {
    const error = run.error ? `\n\n${codeBlock(run.error)}\n\n` : " ";
    return `**docs:needs-input** — I could not update the docs. ${run.reason}${error}I committed nothing. Fix the cause and push, or edit the description, and I will run again.`;
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

/**
 * Error text in a fenced code block, so it reads as a block and markdown inside it does nothing.
 * The fence is longer than any run of backticks in the text, so the text cannot close it.
 */
function codeBlock(text: string): string {
  const clean = text
    .replace(/[^\P{Cc}\n]/gu, " ")
    .trim()
    .slice(0, 2_000);
  const longest = Math.max(0, ...(clean.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${clean}\n${fence}`;
}

const yes = (b: boolean) => (b ? "yes" : "no");

/** The small line under a report: model, tokens and turns. */
function usageLine(u: Usage, model: string | undefined, turns?: number): string {
  return `_${model ?? "model"} · ${n(u.input)} input tokens (${n(u.cached)} from cache) · ${n(u.output)} output tokens${turns ? ` · ${turns} turn${turns === 1 ? "" : "s"}` : ""}_`;
}

/**
 * Model or error text on one line. In the cold start report no such text may start a line: a line of
 * its own could pass as a marker line of the report or as a workflow command of the CI runner.
 */
export const flat = (s: string): string => s.replace(/[\p{Cc}\s]+/gu, " ").trim();

/**
 * The model's note with @mentions, issue references and links put in code, outside existing code spans.
 * GitHub does not ping, link or close anything inside code, so a note cannot close an issue or notify people.
 * A lone backtick becomes a quote mark: it could pair with an added one and free a mention.
 */
export const quiet = (s: string): string =>
  s
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/`/g, "'")
            .replace(/https?:\/\/\S+|[\w.-]+\/[\w.-]+#\d+|\B[@#][\w-]+|\bGH-\d+/gi, "`$&`"),
    )
    .join("");

/**
 * A model note for the init report. Keeps the line breaks: the note is often a list. Other control
 * characters become spaces. A line that starts with "---" is escaped: it could match the log markers
 * that the action cuts the pull request body at.
 */
const noteText = (s: string): string =>
  quiet(
    s
      .replace(/[^\P{Cc}\n]/gu, " ")
      .replace(/^---/gm, "\\---")
      .trim(),
  );

/** The body of the pull request that a cold start opens; locally, the text printed at the end. */
export function renderInitReport(r: {
  written: string[];
  created: string[];
  /** Items still listed in docs/todo.md. */
  left: number;
  /** The run cleared and removed a todo left by an earlier run. */
  removedTodo: boolean;
  notes: string;
  /** The check pass's corrections, one per line. */
  checked?: string;
  /** Why the run stopped before `finish`, when it did. */
  stopped: string | undefined;
  usage: Usage | undefined;
  model: string;
  turns: number | undefined;
}): string {
  const notes = noteText(r.notes);
  const checked = noteText(r.checked ?? "");
  return [
    "## Spriggs: cold start report",
    "",
    "I explored this repository, checked its docs against the code and filled the gaps I found. Review the pages like any other change: they are a draft from the code, not a record of intent.",
    "",
    ...(r.stopped
      ? [`> **Stopped early:** ${flat(r.stopped)}. I kept the pages I had written before that.`, ""]
      : []),
    ...(r.written.length
      ? r.written.map((p) => `- \`${flat(p)}\`${r.created.includes(p) ? " (new page)" : ""}`)
      : ["I wrote no pages."]),
    ...(r.left
      ? [
          "",
          `**${n(r.left)} item${r.left === 1 ? "" : "s"} left to write or check.** The list is in \`docs/todo.md\`, and the next run starts with it.`,
        ]
      : r.stopped
        ? [] // stopped before the plan was written or finished: no claim that the set is complete
        : ["", "I wrote and checked every page I planned."]),
    ...(r.removedTodo ? ["", "I removed `docs/todo.md`: nothing is left."] : []),
    ...(notes ? ["", `A note from the run: ${notes}`] : []),
    ...(checked ? ["", `**Checked against the code after writing:**`, "", checked] : []),
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
          "> **No docs yet:** this repository had no doc pages when I started, and a pull request run only covers one change. For a first set of docs for the whole repository, run the cold start: start the Spriggs workflow by hand from the Actions tab. The workflow needs `workflow_dispatch:` under `on:` for that.",
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

  const note = run.notes ? [`A note from the run: ${quiet(run.notes)}`, ""] : [];
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
  const debt = [
    ...(run.caughtUp?.length
      ? [
          `I also checked the docs for earlier merged pull requests whose docs were never fully updated: ${run.caughtUp.map((pr) => `#${pr}`).join(", ")}. I marked them \`docs:done\`.`,
          "",
        ]
      : []),
    ...(run.moreDebt
      ? [
          "> **More docs debt:** more merged pull requests have unchecked docs than I check in one run. Run the cold start (Actions → spriggs → Run workflow) to check the docs of the whole repository.",
          "",
        ]
      : []),
  ];
  return [...files, ...debt, ...note, ...missed, usageLine(run.usage, run.model, run.turns)];
}
