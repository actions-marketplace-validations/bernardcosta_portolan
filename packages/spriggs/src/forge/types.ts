import type { ForgeContext } from "../context";

export const LABELS = ["docs:done", "docs:partial", "docs:none", "docs:needs-input"] as const;
export type Label = (typeof LABELS)[number];

export type StatusState = "success" | "failure" | "pending";

/** Stored in the sticky comment: lets the next run see whether the description moved with the code. */
export type RunMarker = { bodyHash: string; headSha: string };

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
  /** Commit everything under docs/ as Spriggs and push to the PR branch. */
  commitAndPush(message: string): Promise<PushResult>;
}
