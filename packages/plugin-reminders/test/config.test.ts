import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config, isValidTrigger } from "../src/config.ts"

describe("isValidTrigger", () => {
  test("accepts before/after tool form", () => {
    expect(isValidTrigger("before:tool:question")).toBe(true)
    expect(isValidTrigger("after:tool:bash")).toBe(true)
    expect(isValidTrigger("before:tool:*")).toBe(true)
  })
  test("accepts before/after dispatch form", () => {
    expect(isValidTrigger("before:dispatch:aki-execute")).toBe(true)
    expect(isValidTrigger("after:dispatch:*")).toBe(true)
  })
  test("accepts compaction form", () => {
    expect(isValidTrigger("before:compaction")).toBe(true)
  })
  test("accepts every-turn form", () => {
    expect(isValidTrigger("every:turn:aki-q")).toBe(true)
    expect(isValidTrigger("every:turn:*")).toBe(true)
  })
  test("accepts v1.1 on:event form", () => {
    expect(isValidTrigger("on:event:subagent-finished")).toBe(true)
  })
  test("rejects garbage", () => {
    expect(isValidTrigger("")).toBe(false)
    expect(isValidTrigger("before")).toBe(false)
    expect(isValidTrigger("before:tool")).toBe(false)
    expect(isValidTrigger("during:tool:question")).toBe(false)
    expect(isValidTrigger("before:compaction:extra")).toBe(false)
    expect(isValidTrigger("after:compaction")).toBe(false)
    expect(isValidTrigger("before:tool:bad name")).toBe(false)
    expect(isValidTrigger("on:event:")).toBe(false)
  })
})

describe("Config schema", () => {
  const decode = Schema.decodeUnknownSync(Config)
  test("decodes minimal rule", () => {
    const parsed = decode({
      enabled: true,
      rules: [{ trigger: "before:tool:question", file: "/abs/path.md" }],
    })
    expect(parsed.enabled).toBe(true)
    expect(parsed.rules?.[0]?.trigger).toBe("before:tool:question")
    expect(parsed.rules?.[0]?.file).toBe("/abs/path.md")
  })
  test("decodes rule with scope, mode, tail_bytes", () => {
    const parsed = decode({
      rules: [
        {
          trigger: "before:tool:*",
          file: "/x.md",
          scope: { agent: "aki-*", session: "*", model: "*claude*" },
          mode: "append",
          tail_bytes: 4096,
        },
      ],
      maxFileBytes: 200_000,
    })
    expect(parsed.rules?.[0]?.scope?.agent).toBe("aki-*")
    expect(parsed.rules?.[0]?.mode).toBe("append")
    expect(parsed.rules?.[0]?.tail_bytes).toBe(4096)
    expect(parsed.maxFileBytes).toBe(200_000)
  })
  test("rejects unknown mode", () => {
    expect(() =>
      decode({ rules: [{ trigger: "before:tool:question", file: "/x", mode: "bogus" }] }),
    ).toThrow()
  })
  test("requires trigger and file on rule", () => {
    expect(() => decode({ rules: [{ trigger: "before:tool:question" }] })).toThrow()
    expect(() => decode({ rules: [{ file: "/x" }] })).toThrow()
  })
})
