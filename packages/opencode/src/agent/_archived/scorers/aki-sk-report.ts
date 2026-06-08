import { Effect } from "effect"
import { Registry, type Scorer } from "../scorer"

// F14 Step 7 — ReportScorer (agent: aki-sk-report).
//
// Fault-classification accuracy: fraction of failures the report agent
// assigned the correct fault-taxonomy category, scored against
// human-confirmed labels. Real implementation will pair
// sidekick-context/failure-report-*.md with decision_log entries where
// made_by: human references a report. The scorer computes classification
// accuracy (correct taxonomy categories / total reports) and severity
// calibration (how often the human upgrades/downgrades severity on the
// report).
//
// Skeleton stub returns no rows so the scorer can be registered and wired
// into the GEPA pipeline before the metrics are filled in.
export const ReportScorer: Scorer = {
  agent: "aki-sk-report",
  score: () => Effect.succeed([]),
}

Registry.set(ReportScorer.agent, ReportScorer)

export * as AkiSkReportScorer from "./aki-sk-report"
