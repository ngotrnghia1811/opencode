import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { OrchestratorMeta } from "@/memory/orchestrator-meta"
import { OrchestratorMetaSchema } from "@/memory/orchestrator-meta-schema"
import DESCRIPTION from "./meta-find-similar-variants.txt"

export const Parameters = OrchestratorMetaSchema.FindSimilarParams

type Metadata = {
  task_shape: string
  matches: number
}

export const MetaFindSimilarVariantsTool = Tool.define<typeof Parameters, Metadata, never>(
  "meta_find_similar_variants",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const results = yield* OrchestratorMeta.findSimilarVariants(input.task_shape, input.top_k)
          const lines = results
            .map((r) => `- ${r.variant.variant_id} (sim=${r.similarity.toFixed(2)}): ${r.variant.task_shape}`)
            .join("\n")
          return {
            title: `Found ${results.length} similar variants`,
            output:
              results.length === 0
                ? `No similar variants found for task_shape "${input.task_shape}".`
                : `Top ${results.length} similar variants:\n${lines}`,
            metadata: { task_shape: input.task_shape, matches: results.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
