import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

export const Parameters = Schema.Struct({
  batch: Question.BatchPrompt,
})

type Metadata = {
  answers: ReadonlyArray<Question.AnswerItem>
}

function formatAnswer(answer: Question.AnswerItem): string {
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

function flattenBatchQuestions(batch: Question.BatchPrompt): Array<Question.QuestionItem> {
  return [
    ...(batch.past ?? []),
    ...(batch.present ?? []),
    ...(batch.future ?? []),
    ...(batch.closing ? [batch.closing] : []),
  ]
}

export const QuestionTool = Tool.define<typeof Parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            batch: params.batch,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const questions = flattenBatchQuestions(params.batch)
          const formatted = questions
            .map((q, i) => {
              const answer = answers[i]
              const answerText = answer ? formatAnswer(answer) : "Unanswered"
              return `"${q.header || q.question}"="${answerText}"`
            })
            .join(", ")

          return {
            title: `Asked batch (${questions.length} question${questions.length > 1 ? "s" : ""})`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              answers,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
