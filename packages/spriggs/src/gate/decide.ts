import type { ForgeContext } from "../context";
import type { Signals } from "./signals";

/** Diffs above this many changed lines are "too large to verify" (tuned in M3). */
export const SIZE_CAP_LINES = 800;
/** A description with at least this many words counts as a stated reason, even without a Why section. */
const REASON_MIN_WORDS = 20;

export type Verdict =
  | { outcome: "proceed" }
  | { outcome: "partial"; reason: "diff-too-large" | "reason-missing" }
  | { outcome: "abstain" };

/** Stage two, rules stub. A decision model slots in here later. */
export function decide(s: Signals): Verdict {
  const reasonStated = s.hasWhy || s.bodyWords >= REASON_MIN_WORDS;
  const readable = s.linesChanged <= SIZE_CAP_LINES;
  if (reasonStated && readable) return { outcome: "proceed" };
  if (reasonStated) return { outcome: "partial", reason: "diff-too-large" };
  if (readable) return { outcome: "partial", reason: "reason-missing" };
  return { outcome: "abstain" };
}

/** Why this run should do nothing, or undefined to continue. Exits 0, no status, label unchanged. */
export function skipReason(ctx: ForgeContext, s: Signals): string | undefined {
  if (s.isForkOrBot) return "pull request from a fork or Dependabot: no secrets, read-only token";
  if (ctx.files.length === 0) return "no changed files";
  if (s.onlyDocsChanged) return "only docs/ changed";
  if (ctx.event?.action === "edited") {
    const labels = ctx.pr?.labels ?? [];
    if (!ctx.event.bodyChanged) return "description edit did not change the body";
    if (!labels.includes("docs:needs-input") && !labels.includes("docs:partial")) {
      return "description changed but the last run needed no input";
    }
    return undefined; // a rerun after the author added the reason; the head may be Spriggs's own commit
  }
  if (s.headBySpriggs) return "head commit is Spriggs's own";
  return undefined;
}
