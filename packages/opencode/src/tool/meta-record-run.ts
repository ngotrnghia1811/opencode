import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { OrchestratorMeta } from "@/memory/orchestrator-meta"
import { OrchestratorMetaSchema } from "@/memory/orchestrator-meta-schema"
import DESCRIPTION from "./meta-record-run.txt"

export const Parameters = OrchestratorMetaSchema.RunOutcome

type Metadata = {
  variant_id: string
  run_id: string
}

export const MetaRecordRunTool = Tool.define<typeof Parameters, Metadata, never>(
  "meta_record_run",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* OrchestratorMeta.recordRun(input)
          return {
            title: "Run recorded",
            output: `Run ${input.run_id} for variant ${input.variant_id} recorded (success_score=${input.success_score}).`,
            metadata: { variant_id: input.variant_id, run_id: input.run_id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
