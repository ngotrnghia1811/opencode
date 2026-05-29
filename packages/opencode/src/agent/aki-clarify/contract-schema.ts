import { Schema } from "effect"

export const Requirement = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["functional", "non_functional", "reliability", "security", "data", "ml", "infra"]),
  desc: Schema.String,
  applies_to: Schema.optional(Schema.String),
})

export const Contract = Schema.Struct({
  task: Schema.String,
  version: Schema.String,
  target_agent: Schema.String,
  params: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  requirements: Schema.Array(Requirement),
  constraints: Schema.Array(Schema.String),
  non_goals: Schema.Array(Schema.String),
  acceptance_tests: Schema.Array(Schema.String),
  unknowns_after_ritual: Schema.Array(Schema.String),
  questions_asked: Schema.Number,
  emitted_at: Schema.String,
})

export type Contract = Schema.Schema.Type<typeof Contract>

export * as ClarifyContractSchema from "./contract-schema"
