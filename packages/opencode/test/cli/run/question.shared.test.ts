import { describe, expect, test } from "bun:test"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import {
  createQuestionBodyState,
  questionAcceptAll,
  questionConfirm,
  questionReject,
  questionSave,
  questionSelect,
  questionSetSelected,
  questionStoreCustom,
  questionSubmit,
  questionSync,
  totalQuestions,
} from "@/cli/cmd/run/question.shared"

function makeBatch(batch?: Partial<QuestionRequest["batch"]>): QuestionRequest["batch"] {
  return {
    task: "Test batch",
    summary: "A test batch for unit tests.",
    past: [
      {
        type: "single_select",
        question: "Mode?",
        header: "Mode",
        options: [{ id: "chunked", label: "chunked" }],
        default: "chunked",
      },
    ],
    present: [
      {
        type: "single_select",
        question: "Output?",
        header: "Output",
        options: [
          { id: "yes", label: "yes" },
          { id: "no", label: "no" },
        ],
      },
      {
        type: "multi_select",
        question: "Tags?",
        header: "Tags",
        options: [{ id: "bug", label: "bug" }],
      },
    ],
    future: [
      {
        type: "binary_gate",
        question: "Enable debug?",
        header: "Debug",
        default: "no" as const,
      },
    ],
    ...batch,
  }
}

function req(batch?: Partial<QuestionRequest["batch"]>): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    batch: makeBatch(batch),
  }
}

describe("run question shared", () => {
  test("replies immediately for a single-question batch", () => {
    const r = req({
      past: [
        {
          type: "single_select",
          question: "Mode?",
          header: "Mode",
          options: [{ id: "chunked", label: "chunked" }],
          default: "chunked",
        },
      ],
      present: [],
      future: [],
    })
    const out = questionSelect(createQuestionBodyState("question-1", r.batch), r.batch)
    expect(out.reply).toEqual({
      requestID: "question-1",
      answers: [{ type: "single_select", selection: "chunked" }],
    })
  })

  test("advances multi-question flows", () => {
    const r = req()
    let state = questionSelect(createQuestionBodyState("question-1", r.batch), r.batch).state
    // First question selected, advanced to tab 1
    expect(state.tab).toBe(1)

    state = questionSetSelected(state, 1)
    state = questionSelect(state, r.batch).state
    // Second question, advanced to tab 2
    expect(state.tab).toBe(2)

    // Third question: multi-select toggle (stays on same tab)
    state = questionSelect(state, r.batch).state
    expect(state.tab).toBe(2)
    expect(state.answers[2]).toEqual({ type: "multi_select", selections: ["bug"] })

    // Advance to fourth question (binary gate)
    state = { ...state, tab: 3 }
    state = questionSelect(state, r.batch).state
    // Now on confirm tab (index 4)
    expect(state.tab).toBe(4)
    expect(questionConfirm(r.batch, state)).toBe(true)

    expect(questionSubmit(r.batch, state).answers!.length).toBe(totalQuestions(r.batch))
  })

  test("toggles answers for multi-select questions", () => {
    const r = req({
      past: [],
      present: [{
        type: "multi_select" as const,
        question: "Tags?",
        header: "Tags",
        options: [{ id: "bug", label: "bug" }],
      }],
      future: [],
    })
    let state = questionSelect(createQuestionBodyState("question-1", r.batch), r.batch).state
    expect(state.answers[0]).toEqual({ type: "multi_select", selections: ["bug"] })

    // Toggle off
    state = questionSelect(state, r.batch).state
    expect(state.answers[0]).toEqual({ type: "multi_select", selections: [] })
  })

  test("seeds defaults for binary_gate safe default", () => {
    const r = req({
      past: [],
      present: [],
      future: [
        {
          type: "binary_gate" as const,
          question: "Debug?",
          header: "Debug",
          default: "no" as const,
          destructive: true,
        },
      ],
    })
    const state = createQuestionBodyState("question-1", r.batch)
    // Destructive binary gate defaults to false (safe)
    expect(state.answers[0]).toEqual({ type: "binary_gate", value: false })
  })

  test("accept-all fills unanswered questions with defaults", () => {
    const r = req()
    // Start with no user interaction — only seeded defaults
    const state = createQuestionBodyState("question-1", r.batch)
    const reply = questionAcceptAll(r.batch, state)
    expect(reply.answers!).toHaveLength(totalQuestions(r.batch))
    // First question: default "chunked"
    expect(reply.answers![0]).toEqual({ type: "single_select", selection: "chunked" })
    // Binary gate: default "no"
    expect(reply.answers![3]).toEqual({ type: "binary_gate", value: false })
  })

  test("resets state when the request id changes", () => {
    const state = questionSetSelected(createQuestionBodyState("question-1"), 1)
    expect(questionSync(state, "question-1", req().batch)).toBe(state)
    expect(questionSync(state, "question-2", req().batch).requestID).toBe("question-2")
    expect(questionReject(req())).toEqual({ requestID: "question-1" })
  })
})
