import { Effect } from "effect"
import { Registry, type Scorer } from "../scorer"

// F14 Step 7 — InspectionScorer (agent: aki-inspector).
//
// Real implementation will compute TP / FP / severity-calibration metrics by
// joining verdict files in `.opencode/aki-eval/` with their co-located
// `ack-<verdict_id>.yaml` files (produced via the `verdict_ack` tool / the
// `opencode aki-ack` CLI from F14 Step 6).
//
// Skeleton stub returns no rows so the scorer can be registered and wired
// into the GEPA pipeline before the metrics are filled in.
export const InspectionScorer: Scorer = {
  agent: "aki-inspector",
  score: () => Effect.succeed([]),
}

Registry.set(InspectionScorer.agent, InspectionScorer)

export * as AkiInspectorScorer from "./aki-inspector"
