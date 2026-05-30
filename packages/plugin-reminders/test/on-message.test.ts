import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { isValidTrigger, type Rule } from "../src/config.ts"
import { clearAll } from "../src/pending-injection.ts"
import { matchingRules, messageTrigger, triggerMatches } from "../src/rule-matcher.ts"
import { ReminderPlugin } from "../src/index.ts"

describe("messageTrigger", () => {
  test("builds canonical on:message string", () => {
    expect(messageTrigger("aki-main")).toBe("on:message:aki-main")
    expect(messageTrigger("*")).toBe("on:message:*")
  })
})

describe("isValidTrigger on:message", () => {
  test("accepts on:message agent and wildcard forms", () => {
    expect(isValidTrigger("on:message:aki-main")).toBe(true)
    expect(isValidTrigger("on:message:*")).toBe(true)
  })
  test("rejects empty trailing segment", () => {
    expect(isValidTrigger("on:message:")).toBe(false)
  })
})

describe("triggerMatches on:message", () => {
  test("wildcard agent matches any concrete agent", () => {
    expect(triggerMatches("on:message:*", "on:message:aki-main")).toBe(true)
  })
  test("concrete agent does not match a different agent", () => {
    expect(triggerMatches("on:message:aki-main", "on:message:aki-q")).toBe(false)
  })
})

describe("matchingRules on:message", () => {
  test("wildcard rule matches a resolved message trigger", () => {
    const rules: Rule[] = [{ trigger: "on:message:*", file: "x.md" }]
    const result = matchingRules(rules, {
      trigger: messageTrigger("aki-main"),
      agentName: "aki-main",
      sessionID: "s1",
    })
    expect(result.map((r) => r.file)).toEqual(["x.md"])
  })
  test("scope filters by agent", () => {
    const rules: Rule[] = [{ trigger: "on:message:*", file: "x.md", scope: { agent: "aki-main" } }]
    expect(
      matchingRules(rules, { trigger: messageTrigger("aki-main"), agentName: "aki-main", sessionID: "s1" }),
    ).toHaveLength(1)
    expect(
      matchingRules(rules, { trigger: messageTrigger("aki-q"), agentName: "aki-q", sessionID: "s1" }),
    ).toHaveLength(0)
  })
})

describe("ReminderPlugin chat.message integration", () => {
  afterEach(() => {
    clearAll()
  })

  test("on:message rule enqueued at chat.message surfaces in same turn's system prompt", async () => {
    const dir = path.join(import.meta.dir, "fixtures-on-message")
    const file = path.join(dir, "msg.md")
    const body = "ON MESSAGE REMINDER BODY"
    await Bun.write(file, body)

    const hooks = await ReminderPlugin(
      { directory: dir } as never,
      { enabled: true, rules: [{ trigger: "on:message:*", file: "msg.md" }] },
    )

    const sessionID = "ses_on_message_int"
    await hooks["chat.message"]?.({ sessionID, agent: "aki-main" }, undefined as never)

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({ sessionID } as never, output)

    expect(output.system.some((s) => s.includes(body))).toBe(true)
  })
})
