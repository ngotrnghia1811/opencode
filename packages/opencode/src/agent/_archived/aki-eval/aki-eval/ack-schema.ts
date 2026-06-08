import { Schema } from "effect"

export const Status = Schema.Literals(["accept", "dismiss", "fixed"])

export const AckEntry = Schema.Struct({
  verdict_id: Schema.String,
  finding_id: Schema.String,
  status: Status,
  note: Schema.optional(Schema.String),
  created_at: Schema.String,
})

export const AckFile = Schema.Struct({
  verdict_id: Schema.String,
  acks: Schema.Array(AckEntry),
})

export type AckEntry = Schema.Schema.Type<typeof AckEntry>
export type AckFile = Schema.Schema.Type<typeof AckFile>

export * as AckSchema from "./ack-schema"
