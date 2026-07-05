import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { QuestionTool } from "@opencode-ai/core/tool/question"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_question_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let captured: QuestionV2.AskInput | undefined
let reject = false
let deny = false
const capturedInput = () => captured
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.DeniedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const sampleAnswer: QuestionV2.AnswerItem = { type: "single_select" as const, selection: "Build" }
const emptyAnswer: QuestionV2.AnswerItem = { type: "free_text" as const, value: "" }

const question = Layer.succeed(
  QuestionV2.Service,
  QuestionV2.Service.of({
    ask: (input: QuestionV2.AskInput) =>
      Effect.sync(() => {
        captured = input
      }).pipe(
        Effect.andThen(
          reject
            ? Effect.fail(new QuestionV2.RejectedError())
            : Effect.succeed([sampleAnswer, emptyAnswer]),
        ),
      ),
    reply: () => Effect.die("unused"),
    reject: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, QuestionTool.node]), [
    [PermissionV2.node, permission],
    [QuestionV2.node, question],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

const emptyBatch: QuestionV2.BatchPrompt = {
  task: "test",
  summary: "test",
  present: [
    { type: "free_text" as const, question: "f1", header: "f1" },
    { type: "free_text" as const, question: "f2", header: "f2" },
    { type: "free_text" as const, question: "f3", header: "f3" },
    { type: "free_text" as const, question: "f4", header: "f4" },
  ],
}

const q1: QuestionV2.QuestionItem = {
  type: "single_select" as const,
  question: "What should happen?",
  header: "Action",
  options: [{ id: "Build", label: "Build" }],
}
const q2: QuestionV2.QuestionItem = {
  type: "single_select" as const,
  question: "Which environment?",
  header: "Environment",
  options: [{ id: "Dev", label: "Dev" }],
}
const twoQBatch: QuestionV2.BatchPrompt = {
  task: "test",
  summary: "test batch",
  present: [q1, q2, { type: "free_text" as const, question: "f3", header: "f3" }, { type: "free_text" as const, question: "f4", header: "f4" }],
}

describe("QuestionTool", () => {
  it.effect("omits a denied built-in question and terminally settles a stale call", () =>
    Effect.gen(function* () {
      captured = undefined
      deny = true
      const registry = yield* ToolRegistry.Service

      expect(yield* toolDefinitions(registry, [{ action: "question", resource: "*", effect: "deny" }])).toEqual([])
      expect(
        yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-question-denied", name: "question", input: { batch: emptyBatch } },
        }),
      ).toEqual({ result: { type: "error", value: "Permission denied: question" } })
      expect(capturedInput()).toBeUndefined()
      deny = false
    }),
  )

  it.effect("registers question and projects user answers without a permission assertion", () =>
    Effect.gen(function* () {
      assertions.length = 0
      captured = undefined
      reject = false
      deny = false
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((definition) => definition.name)).toEqual(["question"])
      expect(
        yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-question", name: "question", input: { batch: twoQBatch } },
        }),
      ).toEqual({
        result: {
          type: "text",
          value:
            'User has answered your questions: "What should happen?"="Build", "Which environment?"="Unanswered", "f3"="Unanswered", "f4"="Unanswered". You can now continue with the user\'s answers in mind.',
        },
        output: {
          structured: { answers: [sampleAnswer, emptyAnswer, emptyAnswer, emptyAnswer] },
          content: [
            {
              type: "text",
              text: 'User has answered your questions: "What should happen?"="Build", "Which environment?"="Unanswered", "f3"="Unanswered", "f4"="Unanswered". You can now continue with the user\'s answers in mind.',
            },
          ],
        },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "question", resources: ["*"] }])
      expect(capturedInput()).toEqual({
        sessionID,
        batch: twoQBatch,
        tool: { messageID: toolIdentity.assistantMessageID, callID: "call-question" },
      })
    }),
  )

  it.effect("does not invent tool ownership metadata without a durable registry source", () =>
    Effect.gen(function* () {
      captured = undefined
      reject = false
      deny = false
      const registryService = yield* ToolRegistry.Service

      yield* executeTool(registryService, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-question", name: "question", input: { batch: emptyBatch } },
      })
      expect(capturedInput()).toEqual({
        sessionID,
        batch: emptyBatch,
        tool: { messageID: toolIdentity.assistantMessageID, callID: "call-question" },
      })
    }),
  )

  it.effect("keeps dismissed questions out of model-facing output", () =>
    Effect.gen(function* () {
      captured = undefined
      reject = true
      deny = false
      const registryService = yield* ToolRegistry.Service
      const fiber = yield* executeTool(registryService, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-question", name: "question", input: { batch: emptyBatch } },
      }).pipe(Effect.forkScoped)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
