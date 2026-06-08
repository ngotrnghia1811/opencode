import { Schema } from "effect"

export const Status = Schema.Literals(["accept", "dismiss", "fixed"])

export const ObservationAckEntry = Schema.Struct({
  observation_id: Schema.String,
  status: Status,
  note: Schema.optional(Schema.String),
  created_at: Schema.String,
})

export const ObservationAckFile = Schema.Struct({
  acks: Schema.Array(ObservationAckEntry),
})

export type ObservationAckEntry = Schema.Schema.Type<typeof ObservationAckEntry>
export type ObservationAckFile = Schema.Schema.Type<typeof ObservationAckFile>

export * as ObservationAckSchema from "./ack-schema"
