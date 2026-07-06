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

function makeChoice(label: string, desc: string, recommended = false) {
  return { label, description: desc, recommended }
}

describe("tool.question", () => {
  it.instance("should successfully execute with valid question parameters", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "What is your favorite color?",
          header: "Color",
          time: "present" as const,
          options: [makeChoice("Red (Recommended)", "The color of passion", true), makeChoice("Blue", "The color of sky")],
          multiple: false,
        },
        {
          question: "PAST: Confirm the primary theme?",
          header: "Theme",
          time: "past" as const,
          options: [makeChoice("Dark (Recommended)", "Default dark theme", true), makeChoice("Light", "Light theme")],
        },
        {
          question: "Which font size?",
          header: "Font size",
          time: "present" as const,
          options: [makeChoice("Medium (Recommended)", "Default size", true), makeChoice("Large", "Bigger text")],
        },
        {
          question: "FUTURE: Enable auto-sync later?",
          header: "Auto-sync",
          time: "future" as const,
          options: [makeChoice("Yes (Recommended)", "Sync in background", true), makeChoice("No", "Manual only")],
        },
      ]

      const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      yield* question.reply({ requestID: item.id, answers: [["Red"], ["Dark"], ["Medium"], ["Yes"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.title).toBe("Asked 4 questions")
    }),
  )

  it.instance("should now pass with a header longer than 12 but less than 30 chars", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "What is your favorite animal?",
          header: "This Header is Over 12",
          time: "present" as const,
          options: [makeChoice("Dog", "Man's best friend", true), makeChoice("Cat", "Independent companion")],
        },
        {
          question: "PAST: Confirm the enclosure size?",
          header: "Enclosure",
          time: "past" as const,
          options: [makeChoice("Large (Recommended)", "Roomy default", true), makeChoice("Small", "Compact")],
        },
        {
          question: "Which feeding schedule?",
          header: "Feeding",
          time: "present" as const,
          options: [makeChoice("Twice daily (Recommended)", "Standard", true), makeChoice("Once daily", "Minimal")],
        },
        {
          question: "FUTURE: Add a companion animal later?",
          header: "Companion",
          time: "future" as const,
          options: [makeChoice("Yes (Recommended)", "Social pairing", true), makeChoice("No", "Solo")],
        },
      ]

      const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      yield* question.reply({ requestID: item.id, answers: [["Dog"], ["Large"], ["Twice daily"], ["Yes"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.output).toContain(`"What is your favorite animal?"="Dog"`)
    }),
  )

  it.instance("valid 4-question batch with time + recommended passes through to ask", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "PAST: Confirm the base branch?",
          header: "Base branch",
          time: "past" as const,
          options: [makeChoice("dev (Recommended)", "Default dev branch", true), makeChoice("main", "Main branch")],
        },
        {
          question: "PRESENT: Which package to modify?",
          header: "Package",
          time: "present" as const,
          options: [makeChoice("opencode (Recommended)", "CLI package", true), makeChoice("tui", "TUI package")],
        },
        {
          question: "What test runner?",
          header: "Test runner",
          time: "present" as const,
          options: [makeChoice("bun (Recommended)", "Built-in runner", true), makeChoice("vitest", "Alternative")],
        },
        {
          question: "FUTURE: Deploy strategy?",
          header: "Deploy",
          time: "future" as const,
          options: [makeChoice("Rolling (Recommended)", "Zero-downtime", true), makeChoice("Blue-green", "Full cutover")],
        },
      ]

      const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      expect(item.questions.length).toBe(4)
      yield* question.reply({ requestID: item.id, answers: [["dev"], ["opencode"], ["bun"], ["Rolling"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.title).toBe("Asked 4 questions")
    }),
  )

  it.instance("rejects batch < 4 with teachable message, does not call ask", () =>
    Effect.gen(function* () {
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "Only question?",
          header: "One",
          time: "present" as const,
          options: [makeChoice("Yes", "Confirm")],
        },
      ]

      const result = yield* tool.execute({ questions }, ctx)
      expect(result.output).toContain("at least 4 questions")
      expect(result.output).toContain("You asked 1")
      expect(result.metadata.answers.length).toBe(1)
      expect(result.metadata.answers[0]).toEqual([])
    }),
  )

  it.instance("rejects missing time tag with teachable message", () =>
    Effect.gen(function* () {
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "Q1: Confirm base branch?",
          header: "Base branch",
          time: "past" as const,
          options: [makeChoice("dev (Recommended)", "Default", true), makeChoice("main", "Main")],
        },
        {
          question: "Q2: Which package?",
          header: "Package",
          time: "present" as const,
          options: [makeChoice("opencode (Recommended)", "CLI", true), makeChoice("tui", "TUI")],
        },
        {
          // missing time
          question: "Q3: What test runner?",
          header: "Test runner",
          options: [makeChoice("bun (Recommended)", "Built-in", true), makeChoice("vitest", "Alternative")],
        },
        {
          question: "Q4: Deploy strategy?",
          header: "Deploy",
          time: "future" as const,
          options: [makeChoice("Rolling (Recommended)", "Zero-downtime", true), makeChoice("Blue-green", "Full")],
        },
      ]

      const result = yield* tool.execute({ questions }, ctx)
      expect(result.output).toContain("missing a `time` tag")
      expect(result.output).toContain("Test runner")
    }),
  )

  it.instance("rejects non-destructive choice question without recommended option", () =>
    Effect.gen(function* () {
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "PAST: Confirm base branch?",
          header: "Base branch",
          time: "past" as const,
          options: [makeChoice("dev (Recommended)", "Default", true), makeChoice("main", "Main")],
        },
        {
          question: "PRESENT: Which package?",
          header: "Package",
          time: "present" as const,
          options: [makeChoice("opencode", "CLI"), makeChoice("tui", "TUI")],
        },
        {
          question: "What test runner?",
          header: "Test runner",
          time: "present" as const,
          options: [makeChoice("bun (Recommended)", "Built-in", true), makeChoice("vitest", "Alternative")],
        },
        {
          question: "FUTURE: Deploy strategy?",
          header: "Deploy",
          time: "future" as const,
          options: [makeChoice("Rolling (Recommended)", "Zero-downtime", true), makeChoice("Blue-green", "Full")],
        },
      ]

      const result = yield* tool.execute({ questions }, ctx)
      expect(result.output).toContain("no option has `recommended: true`")
      expect(result.output).toContain("Package")
    }),
  )

  it.instance("rejects destructive question that has recommended option", () =>
    Effect.gen(function* () {
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "PAST: Confirm base branch?",
          header: "Base branch",
          time: "past" as const,
          options: [makeChoice("dev (Recommended)", "Default", true), makeChoice("main", "Main")],
        },
        {
          question: "PRESENT: Which package?",
          header: "Package",
          time: "present" as const,
          options: [makeChoice("opencode (Recommended)", "CLI", true), makeChoice("tui", "TUI")],
        },
        {
          question: "What test runner?",
          header: "Test runner",
          time: "present" as const,
          options: [makeChoice("bun (Recommended)", "Built-in", true), makeChoice("vitest", "Alternative")],
        },
        {
          question: "DANGER: Delete everything?",
          header: "Delete all",
          time: "present" as const,
          destructive: true,
          options: [makeChoice("Keep (Recommended)", "Safe option", true), makeChoice("Delete", "Dangerous")],
        },
      ]

      const result = yield* tool.execute({ questions }, ctx)
      expect(result.output).toContain("destructive: true` but option")
      expect(result.output).toContain("`recommended: true`")
      expect(result.output).toContain("Delete all")
    }),
  )

  it.instance("rejects empty option description with teachable message", () =>
    Effect.gen(function* () {
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "PAST: Confirm base branch?",
          header: "Base branch",
          time: "past" as const,
          options: [makeChoice("dev (Recommended)", "Default", true), makeChoice("main", "Main")],
        },
        {
          question: "PRESENT: Which package?",
          header: "Package",
          time: "present" as const,
          options: [makeChoice("opencode (Recommended)", "CLI", true), makeChoice("tui", "")],
        },
        {
          question: "What test runner?",
          header: "Test runner",
          time: "present" as const,
          options: [makeChoice("bun (Recommended)", "Built-in", true), makeChoice("vitest", "Alternative")],
        },
        {
          question: "FUTURE: Deploy strategy?",
          header: "Deploy",
          time: "future" as const,
          options: [makeChoice("Rolling (Recommended)", "Zero-downtime", true), makeChoice("Blue-green", "Full")],
        },
      ]

      const result = yield* tool.execute({ questions }, ctx)
      expect(result.output).toContain("empty description")
      expect(result.output).toContain("tui")
    }),
  )

  it.instance("passes text/open questions (no options) without requiring recommended", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "PAST: Confirm base?",
          header: "Base",
          time: "past" as const,
          options: [makeChoice("dev (Recommended)", "Default", true), makeChoice("main", "Main")],
        },
        {
          question: "PRESENT: Which package?",
          header: "Package",
          time: "present" as const,
          options: [makeChoice("opencode (Recommended)", "CLI", true), makeChoice("tui", "TUI")],
        },
        {
          question: "What test runner?",
          header: "Test runner",
          time: "present" as const,
          options: [makeChoice("bun (Recommended)", "Built-in", true), makeChoice("vitest", "Alternative")],
        },
        { question: "FUTURE: Any extra notes?", header: "Notes", time: "future" as const, options: [] },
      ]

      const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      yield* question.reply({ requestID: item.id, answers: [["dev"], ["opencode"], ["bun"], []] })

      const result = yield* Fiber.join(fiber)
      expect(result.title).toBe("Asked 4 questions")
    }),
  )
})
