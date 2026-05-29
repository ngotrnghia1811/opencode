import { afterEach, describe, expect, test } from "bun:test"
import { clearAll, drain, enqueue, formatInjection, peek } from "../src/pending-injection.ts"

afterEach(() => {
  clearAll()
})

describe("enqueue / peek / drain", () => {
  test("enqueue + peek + drain on a single session", () => {
    enqueue("ses_a", { text: "hi", mode: "reminder", source: "/a.md" })
    enqueue("ses_a", { text: "there", mode: "append", source: "/b.md" })
    const p = peek("ses_a")
    expect(p).toHaveLength(2)
    expect(p[0]?.text).toBe("hi")
    expect(p[1]?.mode).toBe("append")
    const drained = drain("ses_a")
    expect(drained).toHaveLength(2)
    expect(drained[0]?.source).toBe("/a.md")
    expect(peek("ses_a")).toHaveLength(0)
  })

  test("drain on unknown session returns empty array, not undefined", () => {
    const out = drain("ses_unknown")
    expect(out).toEqual([])
  })

  test("peek on unknown session returns empty array", () => {
    expect(peek("ses_nothing")).toEqual([])
  })

  test("sessions are isolated", () => {
    enqueue("ses_a", { text: "A", mode: "reminder", source: "/a" })
    enqueue("ses_b", { text: "B", mode: "reminder", source: "/b" })
    expect(peek("ses_a")).toHaveLength(1)
    expect(peek("ses_b")).toHaveLength(1)
    drain("ses_a")
    expect(peek("ses_a")).toHaveLength(0)
    expect(peek("ses_b")).toHaveLength(1)
    expect(peek("ses_b")[0]?.text).toBe("B")
  })

  test("clearAll empties every session", () => {
    enqueue("ses_a", { text: "x", mode: "reminder", source: "/a" })
    enqueue("ses_b", { text: "y", mode: "reminder", source: "/b" })
    clearAll()
    expect(peek("ses_a")).toEqual([])
    expect(peek("ses_b")).toEqual([])
  })
})

describe("formatInjection", () => {
  test("reminder wraps text in <system-reminder> with source attribute", () => {
    const out = formatInjection({ text: "do the thing", mode: "reminder", source: "/abs/x.md" })
    expect(out).toBe('<system-reminder source="/abs/x.md">\ndo the thing\n</system-reminder>')
  })

  test("append returns raw text", () => {
    const out = formatInjection({ text: "just append", mode: "append", source: "/abs/y.md" })
    expect(out).toBe("just append")
  })

  test("throws on replace mode (not a system-prompt path)", () => {
    expect(() => formatInjection({ text: "x", mode: "replace", source: "/z" })).toThrow(/replace/)
  })

  test("throws on tool-result-prefix mode (not a system-prompt path)", () => {
    expect(() => formatInjection({ text: "x", mode: "tool-result-prefix", source: "/z" })).toThrow(
      /tool-result-prefix/,
    )
  })
})
