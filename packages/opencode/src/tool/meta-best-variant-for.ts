import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { OrchestratorMeta } from "@/memory/orchestrator-meta"
import { OrchestratorMetaSchema } from "@/memory/orchestrator-meta-schema"
import DESCRIPTION from "./meta-best-variant-for.txt"

export const Parameters = OrchestratorMetaSchema.BestVariantParams

type Metadata = {
  task_class: string
  found: boolean
}

export const MetaBestVariantForTool = Tool.define<typeof Parameters, Metadata, never>(
  "meta_best_variant_for",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const result = yield* OrchestratorMeta.bestVariantFor(input.task_class)
          if (result === null) {
            return {
              title: "No variant history",
              output: `No prior runs found for task_class "${input.task_class}".`,
              metadata: { task_class: input.task_class, found: false },
            }
          }
          return {
            title: "Best variant identified",
            output: `Best variant for "${input.task_class}": ${result.variant.variant_id} (avg_score=${result.avg_score.toFixed(2)}, runs=${result.run_count}).`,
            metadata: { task_class: input.task_class, found: true },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
