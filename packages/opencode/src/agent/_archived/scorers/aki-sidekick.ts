import { Effect } from "effect"
import { Registry, type Scorer } from "../scorer"

// F14 Step 7 — SidekickScorer (agent: aki-sidekick).
//
// HITL escalation precision/recall: did the sidekick escalate the right things
// to the human (and not over-escalate)? Real implementation will parse
// sidekick-state.yaml → decision_log entries with made_by: human that reference
// an escalation, paired with session summary artifacts from
// sidekick-context/session-summary-*.md. The scorer computes precision
// (accepted interrupts / total interrupts fired), recall (interrupts fired /
// ground-truth escalation-worthy events), and false-positive rate (dismissed /
// total). Ground truth is post-session human annotation of the session log.
//
// Skeleton stub returns no rows so the scorer can be registered and wired
// into the GEPA pipeline before the metrics are filled in.
export const SidekickScorer: Scorer = {
  agent: "aki-sidekick",
  score: () => Effect.succeed([]),
}

Registry.set(SidekickScorer.agent, SidekickScorer)

export * as AkiSidekickScorer from "./aki-sidekick"
