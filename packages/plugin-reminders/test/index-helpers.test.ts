import { describe, expect, test } from "bun:test"
import { applyTailBytes, applyTemplate, extractSubagentType } from "../src/helpers.ts"

describe("applyTemplate", () => {
  test("passes through text with no tokens", () => {
    expect(applyTemplate("plain text", {})).toBe("plain text")
    expect(applyTemplate("", {})).toBe("")
  })
  test("substitutes {sessionID}", () => {
    expect(applyTemplate("ses={sessionID}", { sessionID: "ses_abc" })).toBe("ses=ses_abc")
  })
  test("substitutes {agent}", () => {
    expect(applyTemplate("a={agent}", { agent: "aki-execute" })).toBe("a=aki-execute")
  })
  test("substitutes both tokens together", () => {
    expect(applyTemplate("[{agent}] {sessionID}", { agent: "aki-q", sessionID: "ses_x" })).toBe("[aki-q] ses_x")
  })
  test("substitutes multiple occurrences of the same token", () => {
    expect(applyTemplate("{agent}/{agent}/{agent}", { agent: "x" })).toBe("x/x/x")
  })
  test("returns undefined when {sessionID} token present but ctx.sessionID missing", () => {
    expect(applyTemplate("{sessionID}", {})).toBeUndefined()
    expect(applyTemplate("path/{sessionID}.md", { agent: "x" })).toBeUndefined()
  })
  test("returns undefined when {agent} token present but ctx.agent missing", () => {
    expect(applyTemplate("{agent}", {})).toBeUndefined()
    expect(applyTemplate("{agent}/{sessionID}", { sessionID: "s" })).toBeUndefined()
  })
  test("missing token whose name is not used is fine", () => {
    expect(applyTemplate("static", { sessionID: undefined, agent: undefined })).toBe("static")
  })
})

describe("extractSubagentType", () => {
  test("returns undefined for non-task tool", () => {
    expect(extractSubagentType("bash", { subagent_type: "aki-execute" })).toBeUndefined()
    expect(extractSubagentType("read", {})).toBeUndefined()
  })
  test("returns subagent_type string for task tool", () => {
    expect(extractSubagentType("task", { subagent_type: "aki-execute" })).toBe("aki-execute")
    expect(extractSubagentType("task", { subagent_type: "general" })).toBe("general")
  })
  test("returns undefined when args is null or undefined", () => {
    expect(extractSubagentType("task", null)).toBeUndefined()
    expect(extractSubagentType("task", undefined)).toBeUndefined()
  })
  test("returns undefined when args is not an object", () => {
    expect(extractSubagentType("task", "string")).toBeUndefined()
    expect(extractSubagentType("task", 42)).toBeUndefined()
  })
  test("returns undefined when subagent_type key absent", () => {
    expect(extractSubagentType("task", { other: "x" })).toBeUndefined()
    expect(extractSubagentType("task", {})).toBeUndefined()
  })
  test("returns undefined when subagent_type value is non-string", () => {
    expect(extractSubagentType("task", { subagent_type: 42 })).toBeUndefined()
    expect(extractSubagentType("task", { subagent_type: null })).toBeUndefined()
    expect(extractSubagentType("task", { subagent_type: { nested: "x" } })).toBeUndefined()
  })
})

describe("applyTailBytes", () => {
  test("returns text unchanged when tail_bytes is undefined", () => {
    expect(applyTailBytes("hello", undefined, "/x.md")).toBe("hello")
  })
  test("returns text unchanged when tail_bytes is 0", () => {
    expect(applyTailBytes("hello", 0, "/x.md")).toBe("hello")
  })
  test("returns text unchanged when length <= tail_bytes", () => {
    expect(applyTailBytes("hi", 10, "/x.md")).toBe("hi")
    expect(applyTailBytes("exact", 5, "/x.md")).toBe("exact")
  })
  test("returns last N bytes with truncation header when length > tail_bytes", () => {
    const text = "abcdefghij" // length 10
    const result = applyTailBytes(text, 4, "/log.md")
    expect(result).toBe("... [reminders: showing last 4 bytes of /log.md]\n\nghij")
  })
  test("header reflects supplied filePath", () => {
    const result = applyTailBytes("xxxxx", 2, "/some/other/file.md")
    expect(result).toContain("of /some/other/file.md")
    expect(result.endsWith("xx")).toBe(true)
  })
  test("works with empty string", () => {
    expect(applyTailBytes("", 10, "/x.md")).toBe("")
    expect(applyTailBytes("", undefined, "/x.md")).toBe("")
  })
})
