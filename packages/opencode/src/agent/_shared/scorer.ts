import { Effect } from "effect"

// Shared scorer types and registry for F14 (aki-training).
//
// Each agent in the aki-* family has a corresponding Scorer that grades the
// agent's run artefacts (contracts, verdicts, ack files, session summaries)
// against ground-truth signals. The GEPA training sidecar consumes the
// resulting `ScoreRow[]` plus per-row `asi` ("Actionable Side Information")
// to propose new policies for each agent.
//
// See `future/future-aki-training.md` Step 1 for the full design and Step 7
// for the per-agent scorer slots that live under `_shared/scorers/`.

export type ScorerInput = {
  // Paths to trace artefacts for the run being scored. The concrete artefact
  // type depends on the agent (e.g. contract YAML for aki-clarify, verdict
  // YAML + ack JSON for aki-inspector).
  traceFiles: string[]
  // Path to the policy JSON the run was executed under. Lets the scorer
  // attribute scores to a specific policy version.
  policyPath: string
  // Agent name (e.g. "aki-inspector"). Mostly redundant with `Scorer.agent`
  // but kept so a single scorer driver can dispatch across rows.
  agent: string
}

export type ScoreRow = {
  runId: string
  // Normalised to [0, 1].
  score: number
  // Human-readable diagnostic paragraph per GEPA's ASI contract — what
  // failed, what surprised, what suggests the policy could change.
  asi: string
  metadata: Record<string, unknown>
}

export type Scorer = {
  readonly agent: string
  score: (input: ScorerInput) => Effect.Effect<ScoreRow[], Error>
}

// Populated at module init by each scorer file under `_shared/scorers/`.
// Consumers iterate or look up by agent name.
export const Registry = new Map<string, Scorer>()

export * as Scorers from "./scorer"
