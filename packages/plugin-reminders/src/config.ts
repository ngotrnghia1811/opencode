import { Schema } from "effect"

// Trigger grammar (v1):
//   before|after:tool:<id|*>
//   before|after:dispatch:<agent|*>
//   before:compaction
//   every:turn:<agent|*>
//   on:message:<agent|*>  (fires once per user message, before the tool loop)
//   on:event:<name>      (v1.1 — accepted by schema, ignored by matcher in v1)
//
// Validated at runtime in `isValidTrigger`; schema-level type stays
// `string` because Effect 4 beta `Schema.String` does not expose a
// `pattern` combinator. The wiring unit invokes `isValidTrigger` after
// `Schema.decodeUnknownSync(Config)` so invalid triggers surface early.
//
// The optional `label` field on a Rule provides a short (2-3 word)
// human-readable label for the reminder. When set, the agent is
// instructed to confirm receipt by writing a confirmation line:
//   = = = = = = = = = = REMINDED: {label} = = = = = = = = = =
// Rules without a label behave exactly as before (no confirmation).
const TRIGGER_PATTERN =
  /^(?:(?:before|after):(?:tool|dispatch):[\w*.-]+|before:compaction|every:turn:[\w*.-]+|on:message:[\w*.-]+|on:event:[\w.-]+)$/

export function isValidTrigger(value: string): boolean {
  return TRIGGER_PATTERN.test(value)
}

export const Scope = Schema.Struct({
  agent: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})

export const Mode = Schema.Literals(["reminder", "append", "replace", "tool-result-prefix"])

export const Ensure = Schema.Struct({
  path: Schema.String,
  header: Schema.optional(Schema.String),
})

export const Rule = Schema.Struct({
  trigger: Schema.String,
  file: Schema.String,
  scope: Schema.optional(Scope),
  label: Schema.optional(Schema.String),
  mode: Schema.optional(Mode),
  tail_bytes: Schema.optional(Schema.Number),
  ensure: Schema.optional(Schema.Array(Ensure)),
})

export const Config = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  rules: Schema.optional(Schema.Array(Rule)),
  maxFileBytes: Schema.optional(Schema.Number),
})

export type Scope = Schema.Schema.Type<typeof Scope>
export type Mode = Schema.Schema.Type<typeof Mode>
export type Ensure = Schema.Schema.Type<typeof Ensure>
export type Rule = Schema.Schema.Type<typeof Rule>
export type Config = Schema.Schema.Type<typeof Config>

export const DEFAULT_MAX_FILE_BYTES = 100 * 1024
