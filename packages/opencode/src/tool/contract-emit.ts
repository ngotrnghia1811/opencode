import path from "path"
import { absurd, Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "@/session/schema"
import { Question } from "@/question"
import { ContractSchema } from "@/agent/aki-q/contract-schema"
import YAML from "yaml"
import DESCRIPTION from "./contract-emit.txt"

export const Parameters = ContractSchema.Contract

type Metadata = {
  path: string
  summary: string
}

export const ContractEmitTool = Tool.define<typeof Parameters, Metadata, Session.Service | Question.Service | Provider.Service>(
  "contract_emit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const dir = path.join(instance.worktree, ".opencode", "aki-q")
          const fileName = `contract-${Date.now()}.yaml`
          const filePath = path.join(dir, fileName)
          const relPath = path.relative(instance.worktree, filePath)

          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(dir, { recursive: true })
            await fs.writeFile(filePath, YAML.stringify(input), "utf-8")
          })

          const summary = `Contract written to ${relPath}. ${input.requirements.length} requirements, ${input.questions_asked} questions asked.`

          // Detect subagent mode: when invoked via the `task` tool, the
          // current session has a parentID.  In that case we cannot inject a
          // synthetic user message into the parent — the synthetic message
          // would land in the orphaned child session.  Instead, emit a
          // regular text part summarising the contract so `task.ts` can
          // surface it to the calling agent via <task_result>.
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
                metadata: { path: filePath, summary: `Contract: ${input.requirements.length} reqs, ${input.questions_asked}q` },
              },
            })
            return absurd<Tool.ExecuteResult<Metadata>>(null as never)
          }

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Contract emitted to ${relPath}. Approve and switch to build agent?`,
                header: "Contract Approval",
                custom: false,
                options: [
                  { label: "Yes", description: "Approve contract and switch to build agent to implement" },
                  { label: "No", description: "Reject contract and stay with aki-q to revise" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

          const model = yield* provider.defaultModel()

          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `Contract at ${relPath} has been approved. Implement the contract: ${input.requirements.length} requirements, ${input.questions_asked} questions asked.`,
            synthetic: true,
          } satisfies MessageV2.TextPart)

          // Throw StopTurnError so the processor ends the current assistant
          // turn cleanly (status: completed) before the LLM generates a
          // follow-up response.  Without this, the synthetic user message above
          // would be visible in the next prompt-build pass while the current
          // assistant turn is still open, causing Anthropic to reject the
          // request with "conversation must end with a user message".
          yield* new Tool.StopTurnError({
            output: {
              title: "Contract emitted",
              output: `Contract written to ${filePath}. ${input.requirements.length} requirements, ${input.questions_asked} questions asked. Switching to build agent.`,
              metadata: { path: filePath, summary: `Contract: ${input.requirements.length} reqs, ${input.questions_asked}q` },
            },
          })
          return absurd<Tool.ExecuteResult<Metadata>>(null as never)
        }).pipe(Effect.orDie),
    }
  }),
)
