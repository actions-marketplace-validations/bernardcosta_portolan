// Normalised pull request information. Built by a Forge; read by the gate and the agent.

export type Commit = { subject: string; body: string };

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
  };
  /** Commits between base and head, oldest first. Subjects feed the gate; the model sees bodies too. */
  commits: Commit[];
  /** The workflow event that started this run. Absent in --local mode. */
  event?: { action: string; bodyChanged: boolean };
  files: ChangedFile[];
  /** Revision arguments for `git diff` that reproduce `files`. */
  diffRevisions: string[];
  /** The identity Spriggs commits with on this run. */
  self: Identity;
  /** Every email Spriggs may have committed with in this repo. The self-skip rule matches on these. */
  selfEmails: string[];
};

export type Identity = { name: string; email: string };

/** The default identity: the workflow's own token. A GitHub App replaces it with `<app>[bot]`. */
export const DEFAULT_IDENTITY: Identity = {
  name: "github-actions[bot]",
  email: "41898282+github-actions[bot]@users.noreply.github.com",
};
