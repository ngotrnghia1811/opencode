import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Fiber, Queue } from "effect"
import { QuestionTool } from "../../src/tool/question"
import { Question } from "../../src/question"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"

const ctx = {
  sessionID: SessionID.make("ses_test-session"),
  messageID: MessageID.make("msg_test-message"),
  callID: "test-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([Question.node, EventV2Bridge.node, Truncate.node, Agent.node])),
)

const pending = Effect.fn("QuestionToolTest.pending")(function* (question: Question.Interface) {
  const events = yield* EventV2Bridge.Service
  const asked = yield* Queue.unbounded<void>()
  const off = yield* events.listen((event) => {
    if (event.type === Question.Event.Asked.type) Queue.offerUnsafe(asked, undefined)
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  for (;;) {
    const items = yield* question.list()
    const item = items[0]
    if (item) return item
    yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
  }
})

describe("tool.question", () => {
  it.instance("should successfully execute with valid question parameters", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const batch: Question.BatchPrompt = {
        task: "test",
        summary: "test",
        present: [
          {
            type: "single_select" as const,
            question: "What is your favorite color?",
            header: "Color",
            options: [
              { id: "Red", label: "Red" },
              { id: "Blue", label: "Blue" },
            ],
          },
          { type: "free_text" as const, question: "f2", header: "f2" },
          { type: "free_text" as const, question: "f3", header: "f3" },
          { type: "free_text" as const, question: "f4", header: "f4" },
        ],
      }

      const fiber = yield* tool.execute({ batch }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      yield* question.reply({
        requestID: item.id,
        answers: [
          { type: "single_select" as const, selection: "Red" },
          { type: "free_text" as const, value: "" },
          { type: "free_text" as const, value: "" },
          { type: "free_text" as const, value: "" },
        ],
      })

      const result = yield* Fiber.join(fiber)
      expect(result.title).toBe("Asked batch (4 questions)")
    }),
  )

  it.instance("should now pass with a header longer than 12 but less than 30 chars", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const batch: Question.BatchPrompt = {
        task: "test",
        summary: "test",
        present: [
          {
            type: "single_select" as const,
            question: "What is your favorite animal?",
            header: "This Header is Over 12",
            options: [{ id: "Dog", label: "Dog" }],
          },
          { type: "free_text" as const, question: "f2", header: "f2" },
          { type: "free_text" as const, question: "f3", header: "f3" },
          { type: "free_text" as const, question: "f4", header: "f4" },
        ],
      }

      const fiber = yield* tool.execute({ batch }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      yield* question.reply({
        requestID: item.id,
        answers: [
          { type: "single_select" as const, selection: "Dog" },
          { type: "free_text" as const, value: "" },
          { type: "free_text" as const, value: "" },
          { type: "free_text" as const, value: "" },
        ],
      })

      const result = yield* Fiber.join(fiber)
      expect(result.output).toContain(`"What is your favorite animal?"="Dog"`)
    }),
  )
})
