import { DEFAULT_IDENTITY, type ForgeContext } from "../context";
import { changedFiles, commitInfo, commitMessages, git, untrackedFiles } from "../git";
import type { Forge, Label, PushResult, RunMarker, StatusState } from "./types";

/** `--local --base <ref>`: the working copy against the merge-base with <ref>. Prints instead of posting. */
export class LocalForge implements Forge {
  constructor(
    private readonly baseRef: string,
    /** Stands in for the pull request description, so the gate can pass without GitHub. */
    private readonly reason = "",
    private readonly cwd = process.cwd(),
  ) {}

  async getContext(): Promise<ForgeContext> {
    const mergeBase = git(["merge-base", this.baseRef, "HEAD"], this.cwd).trim();
    const head = commitInfo("HEAD", this.cwd);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], this.cwd).trim();
    const remote = git(["config", "--get", "remote.origin.url"], this.cwd).trim();
    return {
      repo: { owner: "", name: "", url: remote, defaultBranch: this.baseRef },
      base: { sha: mergeBase, ref: this.baseRef },
      head: { ...head, ref: branch, repoFullName: "" },
      ...(this.reason
        ? {
            pr: {
              number: 0,
              title: head.subject,
              body: `## Why\n\n${this.reason}\n`,
              author: "",
              labels: [],
            },
          }
        : {}),
      commits: commitMessages(mergeBase, "HEAD", this.cwd),
      self: DEFAULT_IDENTITY,
      selfEmails: [DEFAULT_IDENTITY.email],
      // No second revision: the diff includes uncommitted changes in the working tree.
      files: [...changedFiles([mergeBase], this.cwd), ...(await untrackedFiles(this.cwd))],
      diffRevisions: [mergeBase],
    };
  }

  async previousRun(): Promise<RunMarker | undefined> {
    return undefined;
  }

  async upsertComment(markdown: string, _marker: RunMarker): Promise<void> {
    console.log(`\n--- comment ---\n${markdown}\n--- end comment ---`);
  }

  async setLabel(label: Label): Promise<void> {
    console.log(`label: ${label}`);
  }

  async setStatus(state: StatusState, description: string): Promise<void> {
    console.log(`status: ${state} - ${description}`);
  }

  /** Leaves the docs changes in the working tree for review. Nothing is committed. */
  async commitAndPush(message: string): Promise<PushResult> {
    const stat = git(["diff", "--stat", "--", "docs"], this.cwd).trim();
    const untracked = git(["ls-files", "--others", "--exclude-standard", "docs"], this.cwd).trim();
    console.log(
      `\n--- would commit "${message}" ---\n${[stat, untracked].filter(Boolean).join("\n") || "(no changes)"}\n--- end ---`,
    );
    return "local";
  }
}
