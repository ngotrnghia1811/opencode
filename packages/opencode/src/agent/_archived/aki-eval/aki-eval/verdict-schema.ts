import { Schema } from "effect"

export const Severity = Schema.Literals(["blocking", "major", "minor", "suggestion"])

export const Issue = Schema.Struct({
  id: Schema.String,
  severity: Severity,
  location: Schema.String,
  description: Schema.String,
  suggestion: Schema.optional(Schema.String),
  cross_service_boundary: Schema.optional(Schema.String),
})

export const ContractCoverage = Schema.Struct({
  req_id: Schema.String,
  req: Schema.String,
  status: Schema.Literals(["pass", "fail", "skipped", "partial"]),
  confidence: Schema.Number,
  finding: Schema.optional(Schema.String),
})

export const Verdict = Schema.Struct({
  verdict: Schema.Literals(["pass", "fail"]),
  contract_path: Schema.optional(Schema.String),
  contract_coverage: Schema.Array(ContractCoverage),
  issues: Schema.Array(Issue),
  confidence: Schema.Number,
  probes_run: Schema.Number,
  files_evaluated: Schema.Array(Schema.String),
  emitted_at: Schema.String,
})

export type Verdict = Schema.Schema.Type<typeof Verdict>

export * as VerdictSchema from "./verdict-schema"
