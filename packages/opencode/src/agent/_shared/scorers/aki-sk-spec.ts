import { Effect } from "effect"
import { Registry, type Scorer } from "../scorer"

// F14 Step 7 — SpecScorer (agent: aki-sk-spec).
//
// Plan-inspection catch rate: fraction of plan defects (cycles, missing deps,
// scope creep) the spec agent flagged before the coder hit them. Real
// implementation will correlate sidekick-state.yaml → task_graph.nodes[] with
// failure reports classified as plan_quality. When a subtask fails due to a
// plan_quality fault (underspecified node, ambiguous success signal, missing
// dependency) and that failure was NOT flagged by the plan inspection
// checklist → false negative. Every plan inspection flag the human confirms as
// valid → true positive.
//
// Skeleton stub returns no rows so the scorer can be registered and wired
// into the GEPA pipeline before the metrics are filled in.
export const SpecScorer: Scorer = {
  agent: "aki-sk-spec",
  score: () => Effect.succeed([]),
}

Registry.set(SpecScorer.agent, SpecScorer)

export * as AkiSkSpecScorer from "./aki-sk-spec"
