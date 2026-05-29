import { Schema } from "effect"

export const VariantEntity = Schema.Struct({
  variant_id: Schema.String,
  clarify_config: Schema.String,
  execute_config: Schema.String,
  judge_config: Schema.String,
  rank_config: Schema.String,
  tool_surface: Schema.String,
  task_shape: Schema.String,
  parent_variant_id: Schema.optional(Schema.String),
  modification_summary: Schema.optional(Schema.String),
  created_at: Schema.String,
})

export type VariantEntity = Schema.Schema.Type<typeof VariantEntity>

export const RunOutcome = Schema.Struct({
  variant_id: Schema.String,
  run_id: Schema.String,
  task: Schema.String,
  success_score: Schema.Number,
  edit_burden: Schema.Number,
  repeat_clarification_rate: Schema.Number,
  user_verdict: Schema.Literals(["accept", "reject", "partial"]),
  started_at: Schema.String,
  ended_at: Schema.String,
  superseded_at: Schema.optional(Schema.String),
})

export type RunOutcome = Schema.Schema.Type<typeof RunOutcome>

export const FindSimilarParams = Schema.Struct({
  task_shape: Schema.String,
  top_k: Schema.optional(Schema.Number),
})

export const BestVariantParams = Schema.Struct({
  task_class: Schema.String,
})

export * as OrchestratorMetaSchema from "./orchestrator-meta-schema"
