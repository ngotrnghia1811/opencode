import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { InstanceState } from "@/effect/instance-state"
import { AckSchema } from "@/agent/aki-eval/ack-schema"
import YAML from "yaml"
import DESCRIPTION from "./verdict-ack.txt"

// Candidate dirs where verdict-<id>.yaml may live, in priority order.
// aki-eval is the F12 legacy producer; future aki-judge dir is added here
// when F13 lands without changing the tool surface.
const VERDICT_DIRS = [".opencode/aki-eval", ".opencode/aki-judge"] as const

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
          const verdictDir = yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            for (const rel of VERDICT_DIRS) {
              const abs = path.join(instance.directory, rel)
              const candidate = path.join(abs, `verdict-${input.verdict_id}.yaml`)
              const exists = await fs.stat(candidate).then(
                () => true,
                () => false,
              )
              if (exists) return abs
            }
            // Default to first candidate if no existing verdict found.
            // Ack file will be written even if verdict missing — caller error
            // surfaces in scorer audit rather than blocking the user.
            return path.join(instance.directory, VERDICT_DIRS[0])
          })

          const ackPath = path.join(verdictDir, `ack-${input.verdict_id}.yaml`)
          const now = new Date().toISOString()
          const entry: AckSchema.AckEntry = {
            verdict_id: input.verdict_id,
            finding_id: input.finding_id,
            status: input.status,
            note: input.note,
            created_at: now,
          }

          const updated = yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(verdictDir, { recursive: true })
            const existing = await fs.readFile(ackPath, "utf-8").then(
              (s) => YAML.parse(s) as AckSchema.AckFile,
              () => ({ verdict_id: input.verdict_id, acks: [] }) as AckSchema.AckFile,
            )
            const filtered = existing.acks.filter((a) => a.finding_id !== input.finding_id)
            const next: AckSchema.AckFile = {
              verdict_id: input.verdict_id,
              acks: [...filtered, entry],
            }
            await fs.writeFile(ackPath, YAML.stringify(next), "utf-8")
            return next
          })

          return {
            title: "Verdict ack recorded",
            output: `Ack written to ${ackPath}. finding=${input.finding_id} status=${input.status} total_acks=${updated.acks.length}`,
            metadata: {
              path: ackPath,
              summary: `verdict=${input.verdict_id} finding=${input.finding_id} status=${input.status}`,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
