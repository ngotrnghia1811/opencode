export * as QuestionTool from "./question"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "question"

export const description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- When \`custom\` is enabled (default), a "Type your own answer" option is added automatically; don't include "Other" or catch-all options
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`

export const Input = Schema.Struct({
  batch: QuestionV2.BatchPrompt,
})

export const Output = Schema.Struct({
  answers: Schema.Array(QuestionV2.AnswerItem),
})
export type Output = typeof Output.Type

function formatAnswer(answer: QuestionV2.AnswerItem): string {
  let body: string
  switch (answer.type) {
    case "single_select":
      body = answer.selection
      break
    case "multi_select":
      body = answer.selections.join(", ")
      break
    case "binary_gate":
      body = answer.value ? "yes" : "no"
      break
    case "disambiguation":
      body = typeof answer.selection === "string" ? answer.selection : answer.selection.join(", ")
      break
    case "ranking":
      body = answer.order.join(" > ")
      break
    case "pairwise":
      body = answer.no_preference ? "no preference" : answer.winner
      break
    case "plan_approval": {
      body = answer.decision
      if (answer.notes) body += ` — ${answer.notes}`
      break
    }
    case "diff_review":
      body = answer.decision
      break
    case "editable_default":
      body = answer.value
      break
    case "form":
      body = Object.entries(answer.values)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(", ")
      break
    case "resource_picker":
      body = answer.selection
      break
    case "free_text":
      body = answer.value
      break
    default:
      body = "(unknown answer type)"
  }
  if (answer.comment) body += ` [comment: ${answer.comment}]`
  return body
}

function flattenBatchQuestions(batch: QuestionV2.BatchPrompt): Array<QuestionV2.QuestionItem> {
  return [
    ...(batch.past ?? []),
    ...(batch.present ?? []),
    ...(batch.future ?? []),
    ...(batch.closing ? [batch.closing] : []),
  ]
}

export const toModelOutput = (batch: QuestionV2.BatchPrompt, answers: ReadonlyArray<QuestionV2.AnswerItem>) => {
  const questions = flattenBatchQuestions(batch)
  const formatted = questions
    .map((question, index) => {
      const answer = answers[index]
      if (!answer) return `"${question.question}"="Unanswered"`
      const text = formatAnswer(answer)
      if (!text) return `"${question.question}"="Unanswered"`
      return `"${question.question}"="${text}"`
    })
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const question = yield* QuestionV2.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ input, output }) => [
            { type: "text", text: toModelOutput(input.batch, output.answers) },
          ],
          execute: (input, context) =>
            permission
              .assert({
                action: "question",
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              .pipe(
                Effect.mapError(() => new ToolFailure({ message: "Permission denied: question" })),
                Effect.andThen(() => {
                  const count = flattenBatchQuestions(input.batch).length
                  if (count < 4)
                    return Effect.fail(
                      new ToolFailure({
                        message:
                          "A question batch must contain at least 4 questions across past/present/future/closing horizons. Re-ask with >= 4 questions.",
                      }),
                    )
                  return question
                    .ask({
                      sessionID: context.sessionID,
                      batch: input.batch,
                      tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                    .pipe(Effect.orDie)
                }),
                Effect.map((answers) => {
                  const count = flattenBatchQuestions(input.batch).length
                  const padded = [...answers]
                  while (padded.length < count) {
                    padded.push({ type: "free_text" as const, value: "" })
                  }
                  return { answers: padded }
                }),
              ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/question",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, QuestionV2.node],
})
