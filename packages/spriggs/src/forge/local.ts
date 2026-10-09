import type { ForgeContext } from "../context";
import { changedFiles, commitInfo, git, untrackedFiles } from "../git";
import type { Forge, Label, StatusState } from "./types";

/** `--local --base <ref>`: the working copy against the merge-base with <ref>. Prints instead of posting. */
export class LocalForge implements Forge {
  constructor(
    private readonly baseRef: string,
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
      // No second revision: the diff includes uncommitted changes in the working tree.
      files: [...changedFiles([mergeBase], this.cwd), ...(await untrackedFiles(this.cwd))],
    };
  }

  async upsertComment(markdown: string): Promise<void> {
    console.log(`\n--- comment ---\n${markdown}\n--- end comment ---`);
  }

  async setLabel(label: Label): Promise<void> {
    console.log(`label: ${label}`);
  }

  async setStatus(state: StatusState, description: string): Promise<void> {
    console.log(`status: ${state} - ${description}`);
  }
}
