import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { InstanceState } from "@/effect/instance-state"
import { SidekickStateSchema } from "@/agent/aki-sidekick/sidekick-state-schema"
import YAML from "yaml"
import DESCRIPTION from "./sidekick-state-emit.txt"

export const Parameters = SidekickStateSchema.SidekickState

type Metadata = {
  path: string
  summary: string
}

export const SidekickStateEmitTool = Tool.define<typeof Parameters, Metadata, never>(
  "sidekick_state_emit",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const finalPath = path.join(instance.worktree === "/" ? instance.directory : instance.worktree, "sidekick-state.yaml")
          const tmpPath = finalPath + ".tmp"

          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(path.dirname(finalPath), { recursive: true })
            await fs.writeFile(tmpPath, YAML.stringify(input), "utf-8")
            await fs.rename(tmpPath, finalPath)
          })

          return {
            title: "Sidekick state emitted",
            output: `sidekick-state.yaml written to ${finalPath} (spec v${input.spec.version}, ${input.task_graph.nodes.length} task nodes, ${input.decision_log.length} decisions)`,
            metadata: {
              path: finalPath,
              summary: `v${input.spec.version} nodes=${input.task_graph.nodes.length}`,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
