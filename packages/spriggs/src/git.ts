import type { ChangedFile, Commit } from "./context";

/** Runs git. Paths with non-ASCII characters come out verbatim, not quoted. */
export function git(args: string[], cwd = process.cwd()): string {
  const p = Bun.spawnSync(["git", "-c", "core.quotePath=false", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${p.stderr.toString().trim()}`);
  }
  return p.stdout.toString();
}

/** `git diff --numstat` with the given revision arguments. Binary files count as 0 lines. */
export function changedFiles(revisions: string[], cwd?: string): ChangedFile[] {
  // -z: paths verbatim, NUL-separated. A rename has an empty path field, then the old and new paths.
  const fields = git(["diff", "--numstat", "-z", ...revisions], cwd).split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (!record) continue;
    const [additions = "0", deletions = "0", path = ""] = record.split("\t");
    if (!path) i += 2; // skip the old path; the new path is the record after it
    files.push({
      path: path || fields[i] || "",
      additions: Number(additions) || 0,
      deletions: Number(deletions) || 0,
    });
  }
  return files;
}

/** New files not yet added to git, counted as all-additions. Only --local needs this. */
export async function untrackedFiles(cwd = process.cwd()): Promise<ChangedFile[]> {
  const paths = git(["ls-files", "--others", "--exclude-standard"], cwd)
    .trim()
    .split("\n")
    .filter(Boolean);
  return Promise.all(
    paths.map(async (path) => {
      const text = await Bun.file(`${cwd}/${path}`).text();
      return { path, additions: text.split("\n").filter(Boolean).length, deletions: 0 };
    }),
  );
}

/** The diff split per file: path -> its `diff --git` chunk. Renames are keyed by the new path. */
export function diffByFile(revisions: string[], cwd?: string): Map<string, string> {
  const out = git(["diff", ...revisions, "--", "."], cwd);
  const chunks = new Map<string, string>();
  for (const chunk of out.split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/.*? b\/(.+)$/m.exec(chunk);
    if (m?.[1]) chunks.set(m[1], chunk);
  }
  return chunks;
}

export function commitMessages(base: string, head: string, cwd?: string): Commit[] {
  // Records separated by \x1e, subject and body by \x1f.
  return git(["log", "--reverse", "--format=%s%x1f%b%x1e", `${base}..${head}`], cwd)
    .split("\x1e")
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [subject = "", body = ""] = rec.split("\x1f");
      return { subject: subject.trim(), body: body.trim() };
    });
}

export function commitInfo(
  ref: string,
  cwd?: string,
): { sha: string; authorEmail: string; subject: string } {
  const [sha = "", authorEmail = "", subject = ""] = git(
    ["log", "-1", "--format=%H%n%ae%n%s", ref],
    cwd,
  )
    .trim()
    .split("\n");
  return { sha, authorEmail, subject };
}

/**
 * The change entry the newest entry-adding commit in `base..head` added, when no code commit
 * outside `docs/` comes after it: the docs are current. Needs full history.
 */
export function currentEntry(base: string, head: string, cwd?: string): string | undefined {
  const [sha, , entry] = git(
    [
      "log",
      "-1",
      "--diff-filter=A",
      "--format=%H",
      "--name-only",
      `${base}..${head}`,
      "--",
      "docs/changes/",
    ],
    cwd,
  ).split("\n");
  // The name goes into the PR comment: a plain file name only, anything else gets a full run.
  if (!sha || !entry || !/^docs\/changes\/[\w.-]+\.md$/.test(entry)) return undefined;
  const codeAfter = git(
    ["log", "-1", "--format=%H", `${sha}..${head}`, "--", ".", ":(exclude)docs/"],
    cwd,
  );
  return codeAfter.trim() ? undefined : entry;
}
