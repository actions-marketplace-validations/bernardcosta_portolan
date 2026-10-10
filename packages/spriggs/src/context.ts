// Normalised pull request information. Built by a Forge; read by the gate and the agent.

export type ChangedFile = {
  path: string;
  additions: number;
  deletions: number;
};

export type ForgeContext = {
  repo: { owner: string; name: string; url: string; defaultBranch: string };
  base: { sha: string; ref: string };
  head: { sha: string; ref: string; repoFullName: string; authorEmail: string; subject: string };
  /** Absent in --local mode. */
  pr?: {
    number: number;
    title: string;
    body: string;
    author: string;
    labels: string[];
    /** Commit subjects in the PR, oldest first. */
    commits: string[];
  };
  /** The workflow event that started this run. Absent in --local mode. */
  event?: { action: string; bodyChanged: boolean };
  files: ChangedFile[];
  /** Revision arguments for `git diff` that reproduce `files`. */
  diffRevisions: string[];
};

/** The identity Spriggs commits with. The self-skip rule matches on the email. */
export const SPRIGGS_NAME = "github-actions[bot]";
export const SPRIGGS_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
