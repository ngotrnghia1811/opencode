import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { OrchestratorMeta } from "@/memory/orchestrator-meta"
import { OrchestratorMetaSchema } from "@/memory/orchestrator-meta-schema"
import DESCRIPTION from "./meta-record-variant.txt"

export const Parameters = OrchestratorMetaSchema.VariantEntity

type Metadata = {
  variant_id: string
}

export const MetaRecordVariantTool = Tool.define<typeof Parameters, Metadata, never>(
  "meta_record_variant",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* OrchestratorMeta.recordVariant(input)
          return {
            title: "Variant recorded",
            output: `Variant ${input.variant_id} recorded to meta-memory.`,
            metadata: { variant_id: input.variant_id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
