import type { ChangedFile, Commit } from "./context";

export function git(args: string[], cwd = process.cwd()): string {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${p.stderr.toString().trim()}`);
  }
  return p.stdout.toString();
}

/** `git diff --numstat` with the given revision arguments. Binary files count as 0 lines. */
export function changedFiles(revisions: string[], cwd?: string): ChangedFile[] {
  const out = git(["diff", "--numstat", ...revisions], cwd).trim();
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [additions = "0", deletions = "0", path = ""] = line.split("\t");
    return { path, additions: Number(additions) || 0, deletions: Number(deletions) || 0 };
  });
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
