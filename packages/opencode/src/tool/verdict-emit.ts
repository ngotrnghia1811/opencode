import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { InstanceState } from "@/effect/instance-state"
import { VerdictSchema } from "@/agent/aki-eval/verdict-schema"
import YAML from "yaml"
import DESCRIPTION from "./verdict-emit.txt"

export const Parameters = VerdictSchema.Verdict

type Metadata = {
  path: string
  summary: string
}

export const VerdictEmitTool = Tool.define<typeof Parameters, Metadata, never>(
  "verdict_emit",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const dir = path.join(instance.worktree, ".opencode", "aki-eval")
          const fileName = `verdict-${Date.now()}.yaml`
          const filePath = path.join(dir, fileName)

          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(dir, { recursive: true })
            await fs.writeFile(filePath, YAML.stringify(input), "utf-8")
          })

          const blocking = input.issues.filter((i) => i.severity === "blocking").length
          const major = input.issues.filter((i) => i.severity === "major").length
          const minor = input.issues.filter((i) => i.severity === "minor").length

          return {
            title: "Verdict emitted",
            output: `Verdict written to ${filePath}. verdict=${input.verdict} probes=${input.probes_run} ${blocking} blocking, ${major} major, ${minor} minor.`,
            metadata: {
              path: filePath,
              summary: `verdict=${input.verdict} probes=${input.probes_run} issues=${input.issues.length}`,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
