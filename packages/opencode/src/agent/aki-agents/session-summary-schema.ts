import { Schema } from "effect"

const TurnArcEntry = Schema.Struct({
  turn_index: Schema.Number,
  prompt_summary: Schema.String,
  specialists_invoked: Schema.Array(Schema.String),
  outcome_summary: Schema.String,
})

const AggregateStats = Schema.Struct({
  turns: Schema.Number,
  specialists_invoked_count: Schema.Number,
  tokens_estimated: Schema.Number,
  time_elapsed_seconds: Schema.Number,
})

export const SessionSummary = Schema.Struct({
  session_id: Schema.String,
  started_at: Schema.String,
  ended_at: Schema.String,
  target_agent: Schema.Literal("aki-agents"),
  turn_arc: Schema.Array(TurnArcEntry),
  aggregate_stats: AggregateStats,
  open_threads: Schema.Array(Schema.String),
  redaction_policy: Schema.Literals(["none", "denylist", "strict"]),
  emitted_at: Schema.String,
})

export type SessionSummary = typeof SessionSummary.Type

export * as SessionSummarySchema from "./session-summary-schema"
