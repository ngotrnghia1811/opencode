import { Effect } from "effect"
import { Registry, type Scorer } from "../scorer"

// F14 Step 7 — WatchScorer (agent: aki-sk-watch).
//
// Anomaly-detection precision/recall: did the watcher's Layer-0/1/2 passes
// flag real coder anomalies without excessive false positives (cost discipline
// matters)? Real implementation will pair sidekick-context/progress-*.md with
// post-hoc human review of session diffs. The scorer computes precision and
// recall of Layer 2 anomaly classifications routed to aki-sk-report against
// ground-truth "should have flagged" events annotated post-session.
//
// Skeleton stub returns no rows so the scorer can be registered and wired
// into the GEPA pipeline before the metrics are filled in.
export const WatchScorer: Scorer = {
  agent: "aki-sk-watch",
  score: () => Effect.succeed([]),
}

Registry.set(WatchScorer.agent, WatchScorer)

export * as AkiSkWatchScorer from "./aki-sk-watch"
