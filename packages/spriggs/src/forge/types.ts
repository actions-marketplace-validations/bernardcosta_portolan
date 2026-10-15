import type { ForgeContext } from "../context";

export const LABELS = ["docs:done", "docs:partial", "docs:none", "docs:needs-input"] as const;
export type Label = (typeof LABELS)[number];

export type StatusState = "success" | "failure" | "pending";

/** Stored in the sticky comment: lets the next run see whether the description moved with the code. */
export type RunMarker = { bodyHash: string; headSha: string };

/** A merged pull request whose docs were not fully updated: its run failed or did not read every file. */
export type Debt = { number: number; title: string; files: string[] };

export type PushResult = "pushed" | "superseded" | "nothing" | "local";

/** Everything Spriggs needs from a code host. The orchestrator never talks to GitHub directly. */
export interface Forge {
  getContext(): Promise<ForgeContext>;
  /** What the last run recorded in its sticky comment, if any. */
  previousRun(): Promise<RunMarker | undefined>;
  /** Create or update the one sticky Spriggs comment on the pull request. */
  upsertComment(markdown: string, marker: RunMarker): Promise<void>;
  /** Set exactly one docs:* label, removing the others. */
  setLabel(label: Label): Promise<void>;
  /** The `spriggs` commit status on the head SHA. */
  setStatus(state: StatusState, description: string): Promise<void>;
  /** Merged pull requests on the base branch that still carry docs:needs-input or docs:partial, newest first. */
  docsDebt(limit: number): Promise<Debt[]>;
  /** Mark those pull requests docs:done once a run has checked their changes. */
  clearDebt(prs: number[]): Promise<void>;
  /** Commit everything under docs/ as Spriggs and push to the PR branch. */
  commitAndPush(message: string): Promise<PushResult>;
}
