import { Schema } from "effect"

// Mirrors the state schema from sidekick-design.md §8
export const SidekickState = Schema.Struct({
  spec: Schema.Struct({
    version: Schema.Number,
    objective: Schema.String,
    constraints: Schema.Array(Schema.String),
    non_goals: Schema.Array(Schema.String),
    success_criteria: Schema.Array(Schema.String),
  }),
  task_graph: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      status: Schema.Literals(["pending", "in_progress", "done", "blocked"]),
      assignee: Schema.String,
      depends_on: Schema.Array(Schema.String),
      risk_flags: Schema.Struct({
        level: Schema.Literals(["low", "medium", "high"]),
        justification: Schema.String,
      }),
      artifact_refs: Schema.Array(Schema.String),
    })),
    checkpoint_next: Schema.optional(Schema.String),
  }),
  decision_log: Schema.Array(Schema.Struct({
    id: Schema.Number,
    phase: Schema.Literals(["ELICIT", "SPEC", "PLAN", "EXECUTE", "REPLAN", "REALIGN", "REVIEW", "DONE"]),
    decision: Schema.String,
    rationale: Schema.String,
    timestamp: Schema.String,
    made_by: Schema.Literals(["human", "sidekick"]),
  })),
  session_narrative: Schema.Struct({
    summary: Schema.String,
    open_questions: Schema.Array(Schema.String),
    last_checkpoint: Schema.optional(Schema.String),
  }),
  uncertainty_ledger: Schema.Array(Schema.Struct({
    item: Schema.String,
    severity: Schema.Literals(["low", "medium", "high"]),
    source: Schema.Literals(["coder_output", "spec", "human_input"]),
    status: Schema.Literals(["open", "escalated", "resolved"]),
  })),
  trust_ledger: Schema.Array(Schema.Struct({
    artifact: Schema.String,
    validated_by: Schema.String,
    timestamp: Schema.String,
    reuse_scope: Schema.String,
  })),
})

export type SidekickState = typeof SidekickState.Type

export * as SidekickStateSchema from "./sidekick-state-schema"
