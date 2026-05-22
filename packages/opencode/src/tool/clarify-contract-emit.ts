import path from "path"
import { absurd, Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { InstanceState } from "@/effect/instance-state"
import { PartID } from "@/session/schema"
import { ClarifyContractSchema } from "@/agent/aki-clarify/contract-schema"
import YAML from "yaml"
import DESCRIPTION from "./clarify-contract-emit.txt"

export const Parameters = ClarifyContractSchema.Contract

type Metadata = {
  path: string
  summary: string
  target_agent: string
}

export const ClarifyContractEmitTool = Tool.define<typeof Parameters, Metadata, Session.Service>(
  "clarify_contract_emit",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const dir = path.join(instance.worktree, ".opencode", "aki-clarify")
          const fileName = `contract-${Date.now()}.yaml`
          const filePath = path.join(dir, fileName)
          const relPath = path.relative(instance.worktree, filePath)

          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(dir, { recursive: true })
            await fs.writeFile(filePath, YAML.stringify(input), "utf-8")
          })

          const summary = `Contract written to ${relPath}. target_agent=${input.target_agent}, ${input.requirements.length} requirements, ${input.questions_asked} questions asked.`

          // Subagent short-circuit: emit summary text part and stop. aki-clarify
          // is invoked via the task tool by @aki-main or specialists; the
          // calling agent reads the YAML from disk and routes to target_agent.
          const currentSession = yield* session.get(ctx.sessionID)
          if (currentSession.parentID) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.messageID,
              sessionID: ctx.sessionID,
              type: "text",
              text: summary,
            } satisfies MessageV2.TextPart)
            yield* new Tool.StopTurnError({
              output: {
                title: "Contract emitted",
                output: summary,
                metadata: {
                  path: filePath,
                  summary: `target=${input.target_agent} reqs=${input.requirements.length} q=${input.questions_asked}`,
                  target_agent: input.target_agent,
                },
              },
            })
            return absurd<Tool.ExecuteResult<Metadata>>(null as never)
          }

          // Primary path (rare for aki-clarify, mode:subagent + hidden): no
          // agent-switch logic — routing to target_agent is the caller's
          // responsibility. Just return the summary and let the user route.
          return {
            title: "Contract emitted",
            output: summary,
            metadata: {
              path: filePath,
              summary: `target=${input.target_agent} reqs=${input.requirements.length} q=${input.questions_asked}`,
              target_agent: input.target_agent,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
