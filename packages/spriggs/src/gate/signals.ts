import type { ForgeContext } from "../context";
import type { PortolanConfig } from "../docs/portolan";

export type Kind = "added" | "changed" | "fixed" | "removed" | "deprecated" | "internal";

/** Stage one of the gate: facts a plain script can read. No model. */
export type Signals = {
  descriptionPresent: boolean;
  hasWhy: boolean;
  bodyWords: number;
  /** Conventional Commits type from the title, else from the first commit. */
  conventionalType?: string;
  /** Mechanical mapping from the type. `feat` is "added" here; the model may narrow it to "changed". */
  kind?: Kind;
  breaking: boolean;
  issueIds: string[];
  filesChanged: number;
  linesChanged: number;
  touchesApi: boolean;
  touchesSchema: boolean;
  touchesConfig: boolean;
  onlyDocsChanged: boolean;
  headBySpriggs: boolean;
  isForkOrBot: boolean;
};

const KIND_BY_TYPE: Record<string, Kind> = {
  feat: "added",
  fix: "fixed",
  perf: "changed",
  refactor: "internal",
  chore: "internal",
  ci: "internal",
  build: "internal",
  test: "internal",
  style: "internal",
  docs: "internal",
};

/** Lockfiles and other generated files: never counted, never shown to the model. */
const GENERATED = [
  /(^|\/)[^/]*\.lock$/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.sum|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock)$/,
];
export const isGenerated = (path: string): boolean => GENERATED.some((re) => re.test(path));

// type(scope)!: subject
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?(!)?:\s/;

function conventional(subject: string): { type: string; bang: boolean } | undefined {
  const m = CONVENTIONAL.exec(subject);
  return m?.[1] ? { type: m[1].toLowerCase(), bang: m[2] === "!" } : undefined;
}

/** The text under a "Why" heading, or "" when there is none. */
export function whySection(body: string): string {
  // From a "Why" heading to the next heading or the end of the body. No `m` flag: `$` is the end.
  const m = /(?:^|\n)#{1,6}[ \t]*why\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}[ \t]|$)/i.exec(body);
  return (m?.[1] ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
}

function words(text: string): number {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function signals(ctx: ForgeContext, config?: PortolanConfig): Signals {
  const body = ctx.pr?.body ?? "";
  const title = ctx.pr?.title ?? ctx.head.subject;
  const subjects = [title, ...ctx.commits.map((c) => c.subject)];
  const cc = subjects.map(conventional).find(Boolean);
  const breaking = subjects.some((s) => conventional(s)?.bang) || /BREAKING[ -]CHANGE:/.test(body);

  const issuePattern = config?.issues?.pattern ? new RegExp(config.issues.pattern, "g") : /#\d+/g;
  const issueIds = [...new Set(`${title}\n${body}`.match(issuePattern) ?? [])];

  const paths = ctx.files.map((f) => f.path);
  return {
    descriptionPresent: words(body) > 0,
    hasWhy: whySection(body).length > 0,
    bodyWords: words(body),
    ...(cc ? { conventionalType: cc.type } : {}),
    ...(cc && KIND_BY_TYPE[cc.type] ? { kind: KIND_BY_TYPE[cc.type] } : {}),
    breaking,
    issueIds,
    filesChanged: ctx.files.length,
    linesChanged: ctx.files
      .filter((f) => !isGenerated(f.path))
      .reduce((n, f) => n + f.additions + f.deletions, 0),
    touchesApi: paths.some(
      (p) => /(^|\/)api\//.test(p) || /\.(proto|graphql|openapi\.(ya?ml|json))$/.test(p),
    ),
    touchesSchema: paths.some((p) => /schema|migration/i.test(p)),
    touchesConfig: paths.some(
      (p) => /(^|\/)[^/]*\.(ya?ml|toml|json|env\.example)$/.test(p) && !p.startsWith("docs/"),
    ),
    onlyDocsChanged: paths.length > 0 && paths.every((p) => p.startsWith("docs/")),
    headBySpriggs: ctx.selfEmails.includes(ctx.head.authorEmail),
    isForkOrBot:
      ctx.pr !== undefined &&
      (ctx.pr.author === "dependabot[bot]" ||
        (ctx.head.repoFullName !== "" &&
          ctx.head.repoFullName !== `${ctx.repo.owner}/${ctx.repo.name}`)),
  };
}
