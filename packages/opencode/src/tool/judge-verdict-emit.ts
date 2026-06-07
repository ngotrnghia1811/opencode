import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { InstanceState } from "@/effect/instance-state"
import { JudgeVerdictSchema } from "@/agent/aki-judge/verdict-schema"
import YAML from "yaml"
import DESCRIPTION from "./judge-verdict-emit.txt"

export const Parameters = JudgeVerdictSchema.Verdict

type Metadata = {
  path: string
  summary: string
  target_agent: string
}

export const JudgeVerdictEmitTool = Tool.define<typeof Parameters, Metadata, never>(
  "judge_verdict_emit",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const dir = path.join(instance.worktree === "/" ? instance.directory : instance.worktree, ".opencode", "aki-judge")
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
            output: `Verdict written to ${filePath}. target=${input.target_agent} verdict=${input.verdict} probes=${input.probes_run} ${blocking} blocking, ${major} major, ${minor} minor.`,
            metadata: {
              path: filePath,
              summary: `target=${input.target_agent} verdict=${input.verdict} probes=${input.probes_run} issues=${input.issues.length}`,
              target_agent: input.target_agent,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
