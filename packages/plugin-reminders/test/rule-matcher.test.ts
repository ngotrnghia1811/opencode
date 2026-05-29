import { describe, expect, test } from "bun:test"
import type { Rule } from "../src/config.ts"
import {
  COMPACTION_TRIGGER,
  dispatchAfterTrigger,
  dispatchBeforeTrigger,
  everyTurnTrigger,
  globMatch,
  matchingRules,
  scopeMatches,
  toolAfterTrigger,
  toolBeforeTrigger,
  triggerMatches,
} from "../src/rule-matcher.ts"

describe("triggerMatches", () => {
  test("exact match", () => {
    expect(triggerMatches("before:tool:question", "before:tool:question")).toBe(true)
  })
  test("wildcard in trailing segment", () => {
    expect(triggerMatches("before:tool:*", "before:tool:question")).toBe(true)
    expect(triggerMatches("after:dispatch:*", "after:dispatch:aki-execute")).toBe(true)
  })
  test("wildcard does not match across segment count", () => {
    expect(triggerMatches("before:tool:*", "before:tool:question:extra")).toBe(false)
    expect(triggerMatches("before:tool:question", "before:tool")).toBe(false)
  })
  test("non-matching literal", () => {
    expect(triggerMatches("before:tool:question", "after:tool:question")).toBe(false)
    expect(triggerMatches("before:tool:question", "before:tool:bash")).toBe(false)
  })
  test("wildcard in middle segment", () => {
    expect(triggerMatches("before:*:question", "before:tool:question")).toBe(true)
    expect(triggerMatches("before:*:question", "before:dispatch:question")).toBe(true)
  })
})

describe("globMatch", () => {
  test("undefined value only matches literal `*`", () => {
    expect(globMatch("*", undefined)).toBe(true)
    expect(globMatch("anything", undefined)).toBe(false)
    expect(globMatch("aki-*", undefined)).toBe(false)
  })
  test("bare `*` matches any defined value", () => {
    expect(globMatch("*", "anything")).toBe(true)
    expect(globMatch("*", "")).toBe(true)
  })
  test("literal pattern is exact-match", () => {
    expect(globMatch("aki-execute", "aki-execute")).toBe(true)
    expect(globMatch("aki-execute", "aki-execut")).toBe(false)
    expect(globMatch("aki-execute", "aki-execute2")).toBe(false)
  })
  test("partial wildcards", () => {
    expect(globMatch("aki-*", "aki-execute")).toBe(true)
    expect(globMatch("aki-*", "build")).toBe(false)
    expect(globMatch("*claude*", "anthropic-claude-opus")).toBe(true)
    expect(globMatch("*claude*", "gpt-4")).toBe(false)
  })
  test("regex-special chars are escaped", () => {
    expect(globMatch("a.b", "axb")).toBe(false)
    expect(globMatch("a.b", "a.b")).toBe(true)
    expect(globMatch("a+b", "a+b")).toBe(true)
    expect(globMatch("a+b", "aab")).toBe(false)
    expect(globMatch("a(b)c", "a(b)c")).toBe(true)
  })
})

describe("scopeMatches", () => {
  const input = { trigger: "before:tool:question", agentName: "aki-execute", sessionID: "ses_abc", modelID: "claude-opus-4.7" }
  test("undefined scope matches anything", () => {
    expect(scopeMatches(undefined, input)).toBe(true)
  })
  test("matches when all present scope keys match", () => {
    expect(scopeMatches({ agent: "aki-*", model: "*claude*" }, input)).toBe(true)
  })
  test("fails when any present scope key fails", () => {
    expect(scopeMatches({ agent: "other" }, input)).toBe(false)
    expect(scopeMatches({ session: "ses_xyz" }, input)).toBe(false)
    expect(scopeMatches({ model: "gpt-*" }, input)).toBe(false)
  })
  test("absent scope keys are ignored", () => {
    expect(scopeMatches({}, input)).toBe(true)
  })
  test("undefined input values only match `*`", () => {
    expect(scopeMatches({ agent: "*" }, { trigger: "t" })).toBe(true)
    expect(scopeMatches({ agent: "aki-*" }, { trigger: "t" })).toBe(false)
  })
})

describe("matchingRules", () => {
  const rules: Rule[] = [
    { trigger: "before:tool:question", file: "/a" },
    { trigger: "before:tool:*", file: "/b", scope: { agent: "aki-*" } },
    { trigger: "after:tool:question", file: "/c" },
  ]
  test("returns only rules whose trigger and scope both match", () => {
    const result = matchingRules(rules, { trigger: "before:tool:question", agentName: "aki-execute" })
    expect(result.map((r) => r.file)).toEqual(["/a", "/b"])
  })
  test("scope mismatch filters out wildcard rule", () => {
    const result = matchingRules(rules, { trigger: "before:tool:question", agentName: "other" })
    expect(result.map((r) => r.file)).toEqual(["/a"])
  })
  test("empty input trigger matches nothing", () => {
    expect(matchingRules(rules, { trigger: "before:tool:bash", agentName: "aki-execute" })).toHaveLength(1)
  })
})

describe("trigger builders", () => {
  test("produce canonical strings", () => {
    expect(toolBeforeTrigger("question")).toBe("before:tool:question")
    expect(toolAfterTrigger("question")).toBe("after:tool:question")
    expect(dispatchBeforeTrigger("aki-execute")).toBe("before:dispatch:aki-execute")
    expect(dispatchAfterTrigger("aki-execute")).toBe("after:dispatch:aki-execute")
    expect(everyTurnTrigger("aki-q")).toBe("every:turn:aki-q")
    expect(COMPACTION_TRIGGER).toBe("before:compaction")
  })
})
