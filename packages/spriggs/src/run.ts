import { loadPortolanConfig } from "./docs/portolan";
import type { Forge, Label, StatusState } from "./forge/types";
import { decide, skipReason, type Verdict } from "./gate/decide";
import { type Signals, signals } from "./gate/signals";
import { renderComment, verdictLine } from "./report";

function labelFor(v: Verdict): Label {
  if (v.outcome === "proceed") return "docs:done";
  if (v.outcome === "partial") return "docs:partial";
  return "docs:needs-input";
}

function statusFor(v: Verdict, s: Signals): [StatusState, string] {
  const blocking = process.env.SPRIGGS_BLOCKING === "true" || s.breaking;
  if (v.outcome === "abstain" && blocking) return ["failure", "needs input: add a Why section"];
  return ["success", verdictLine(v, s).replace(/\*\*/g, "")];
}

/** context -> skip rules -> stage one -> decide -> comment -> label -> status. Returns the exit code. */
export async function run(forge: Forge, cwd = process.cwd()): Promise<number> {
  const ctx = await forge.getContext();
  const { config, errors } = await loadPortolanConfig(cwd);
  for (const e of errors) console.warn(`warning: ${e}`);

  const s = signals(ctx, config);
  const skip = skipReason(ctx, s);
  if (skip) {
    console.log(`skip: ${skip}`);
    return 0;
  }

  const verdict = decide(s);
  console.log(`gate: ${verdict.outcome}${"reason" in verdict ? ` (${verdict.reason})` : ""}`);

  await forge.upsertComment(renderComment(s, verdict));
  await forge.setLabel(labelFor(verdict));
  await forge.setStatus(...statusFor(verdict, s));
  return 0;
}
