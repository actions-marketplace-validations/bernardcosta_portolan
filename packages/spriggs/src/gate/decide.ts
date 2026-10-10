import type { ForgeContext } from "../context";
import type { Signals } from "./signals";

/** Up to this many changed lines (generated files excluded) the whole diff goes to the model in one phase. */
export const SIZE_CAP_LINES = 1500;
/** Above this many lines Spriggs asks the author to split the change. `SPRIGGS_MAX_LINES` overrides. */
export const DEFAULT_MAX_LINES = 5000;
/** A description with at least this many words counts as a stated reason, even without a Why section. */
const REASON_MIN_WORDS = 20;

/** small: one phase. large: triage first, then write. */
export type Tier = "small" | "large";

export type Verdict =
  | { outcome: "proceed"; tier: Tier }
  | { outcome: "partial"; reason: "reason-missing"; tier: Tier }
  | { outcome: "abstain"; reason: "reason-missing" | "too-large" };

export function maxLines(env = process.env): number {
  return Number(env.SPRIGGS_MAX_LINES) || DEFAULT_MAX_LINES;
}

/** Stage two, rules stub. A decision model slots in here later. */
export function decide(s: Signals, limit = maxLines()): Verdict {
  const reasonStated = s.hasWhy || s.bodyWords >= REASON_MIN_WORDS;
  if (s.linesChanged > limit) return { outcome: "abstain", reason: "too-large" };
  const tier: Tier = s.linesChanged <= SIZE_CAP_LINES ? "small" : "large";
  if (reasonStated) return { outcome: "proceed", tier };
  // Without a reason, a small change still gets its facts updated. A large one needs the author first.
  if (tier === "small") return { outcome: "partial", reason: "reason-missing", tier };
  return { outcome: "abstain", reason: "reason-missing" };
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
  // A CI rule: no self-triggering. Locally a developer may run right after a Spriggs commit.
  if (s.headBySpriggs && ctx.event) return "head commit is Spriggs's own";
  return undefined;
}
