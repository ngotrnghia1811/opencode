import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(Question.Prompt)).annotate({ description: "Questions to ask" }),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
}

function checkViolations(params: Schema.Schema.Type<typeof Parameters>): string | undefined {
  const questions = params.questions

  if (questions.length < 4) {
    return `A question batch must contain at least 4 questions. You asked ${questions.length}. Re-ask as a single batch of >= 4 questions spanning past/present/future horizons.`
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const head = q.header || `question ${i + 1}`

    if (!q.time) {
      return `Question "${head}" (index ${i}) is missing a \`time\` tag. Every question must declare its temporal horizon: "past", "present", or "future".`
    }

    if (q.destructive) {
      const recommended = q.options.findIndex((o) => o.recommended === true)
      if (recommended !== -1) {
        return `Question "${head}" (index ${i}) is marked \`destructive: true\` but option ${recommended} has \`recommended: true\`. Destructive questions must have zero recommended options — no pre-selected default on dangerous actions. Remove \`recommended\` from all options on this question.`
      }
    }

    if (!q.destructive && q.options.length > 0) {
      const hasRecommended = q.options.some((o) => o.recommended === true)
      if (!hasRecommended) {
        return `Question "${head}" (index ${i}) is a non-destructive choice question with ${q.options.length} options but no option has \`recommended: true\`. Every non-destructive choice question must have at least one recommended (honest default) option.`
      }
    }

    for (let j = 0; j < q.options.length; j++) {
      const desc = q.options[j].description?.trim()
      if (!desc) {
        return `Question "${head}" (index ${i}), option ${j} ("${q.options[j].label || "unnamed"}") has an empty description. Every option must have a non-empty description explaining the trade-offs.`
      }
    }
  }

  return undefined
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
          const violation = checkViolations(params)
          if (violation) {
            return {
              title: `Question batch rejected`,
              output: violation,
              metadata: {
                answers: params.questions.map(() => [] as Question.Answer),
              },
            }
          }

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              answers,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
