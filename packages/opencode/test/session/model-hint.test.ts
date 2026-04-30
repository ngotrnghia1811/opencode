import { test, expect } from "bun:test"

import { parseModelHint } from "@/session/model-hint"

// Pure unit tests for the `/_switch <token>` directive parser.
// No Effect/services needed — this is a string→string function.

test("parses bare alias with remainder", () => {
  expect(parseModelHint("/_switch sonnet hello")).toEqual({
    token: "sonnet",
    remainder: "hello",
  })
})

test("parses canonical provider/model form with remainder", () => {
  expect(parseModelHint("/_switch anthropic/claude-sonnet-4-5 redesign auth")).toEqual({
    token: "anthropic/claude-sonnet-4-5",
    remainder: "redesign auth",
  })
})

test("strips leading whitespace before the directive", () => {
  expect(parseModelHint("  /_switch opus do thing")).toEqual({
    token: "opus",
    remainder: "do thing",
  })
})

test("supports a directive on its own first line followed by a body", () => {
  expect(parseModelHint("/_switch opus\nWrite a complete redesign")).toEqual({
    token: "opus",
    remainder: "Write a complete redesign",
  })
})

test("returns directive with empty remainder when only directive is present", () => {
  expect(parseModelHint("/_switch opus")).toEqual({
    token: "opus",
    remainder: "",
  })
})

test("ignores directive in the middle of a message", () => {
  expect(parseModelHint("hello /_switch opus and also do X")).toBeUndefined()
})

test("ignores other slash commands (no underscore prefix)", () => {
  expect(parseModelHint("/help me")).toBeUndefined()
  expect(parseModelHint("/models")).toBeUndefined()
})

test("ignores directive without a token argument", () => {
  expect(parseModelHint("/_switch")).toBeUndefined()
  expect(parseModelHint("/_switch ")).toBeUndefined()
})

test("ignores '/_switchopus' with no whitespace separator", () => {
  expect(parseModelHint("/_switchopus")).toBeUndefined()
})

test("returns undefined for empty string", () => {
  expect(parseModelHint("")).toBeUndefined()
})

test("supports tokens containing dots, colons, and dashes", () => {
  expect(parseModelHint("/_switch openrouter/meta-llama/llama-3.3-70b-instruct:free do X")).toEqual({
    token: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    remainder: "do X",
  })
})

test("collapses multiple spaces after the token", () => {
  expect(parseModelHint("/_switch sonnet   hello")).toEqual({
    token: "sonnet",
    remainder: "hello",
  })
})
