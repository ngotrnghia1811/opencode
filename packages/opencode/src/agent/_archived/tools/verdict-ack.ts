import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { InstanceState } from "@/effect/instance-state"
import { AckSchema } from "@/agent/aki-eval/ack-schema"
import { writeAck } from "@/agent/aki-eval/ack-write"
import DESCRIPTION from "./verdict-ack.txt"

export const Parameters = Schema.Struct({
  verdict_id: Schema.String,
  finding_id: Schema.String,
  status: AckSchema.Status,
  note: Schema.optional(Schema.String),
})

type Metadata = {
  path: string
  summary: string
}

export const VerdictAckTool = Tool.define<typeof Parameters, Metadata, never>(
  "verdict_ack",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const result = yield* Effect.promise(() => writeAck(instance.directory, input))
          return {
            title: "Verdict ack recorded",
            output: `Ack written to ${result.path}. finding=${input.finding_id} status=${input.status} total_acks=${result.total}`,
            metadata: {
              path: result.path,
              summary: `verdict=${input.verdict_id} finding=${input.finding_id} status=${input.status}`,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
