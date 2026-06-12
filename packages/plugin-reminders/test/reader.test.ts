import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readPlan, readQA } from "../src/reader.ts"
import { appendPlan, appendQA } from "../src/storage.ts"

describe("readQA", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reminders-reader-qa-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("returns empty array when date file does not exist", async () => {
    const entries = await readQA(dir, "2026-06-05")
    expect(entries).toEqual([])
  })

  test("parses a single entry correctly", async () => {
    await appendQA(dir, "2026-06-05", "14:22", "aki-main", "ses_abc123", null, "How to fix?", "Fix the bug.")

    const entries = await readQA(dir, "2026-06-05")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.time).toBe("14:22")
    expect(entries[0]!.agentName).toBe("aki-main")
    expect(entries[0]!.sessionId).toBe("ses_abc123")
    expect(entries[0]!.parentId).toBeNull()
    expect(entries[0]!.question).toBe("How to fix?")
    expect(entries[0]!.answer).toBe("Fix the bug.")
  })

  test("parses entry with parent correctly", async () => {
    await appendQA(dir, "2026-06-05", "14:23", "aki-execute", "ses_def456", "ses_abc123", "Q2", "A2")

    const entries = await readQA(dir, "2026-06-05")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.parentId).toBe("ses_abc123")
  })

  test("parses multiple entries in order", async () => {
    await appendQA(dir, "2026-06-05", "10:00", "aki-main", "s1", null, "Q1", "A1")
    await appendQA(dir, "2026-06-05", "11:00", "aki-execute", "s2", "s1", "Q2", "A2")
    await appendQA(dir, "2026-06-05", "12:00", "aki-main", "s3", null, "Q3", "A3")

    const entries = await readQA(dir, "2026-06-05")
    expect(entries).toHaveLength(3)
    expect(entries[0]!.sessionId).toBe("s1")
    expect(entries[1]!.sessionId).toBe("s2")
    expect(entries[2]!.sessionId).toBe("s3")
  })

  test("filters by sessionId", async () => {
    await appendQA(dir, "2026-06-05", "10:00", "aki-main", "s1", null, "Q1", "A1")
    await appendQA(dir, "2026-06-05", "11:00", "aki-execute", "s2", "s1", "Q2", "A2")

    const entries = await readQA(dir, "2026-06-05", { sessionId: "s1" })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.sessionId).toBe("s1")
  })

  test("filters by agentName", async () => {
    await appendQA(dir, "2026-06-05", "10:00", "aki-main", "s1", null, "Q1", "A1")
    await appendQA(dir, "2026-06-05", "11:00", "aki-execute", "s2", "s1", "Q2", "A2")

    const entries = await readQA(dir, "2026-06-05", { agentName: "aki-execute" })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.agentName).toBe("aki-execute")
  })

  test("filters by both sessionId and agentName", async () => {
    await appendQA(dir, "2026-06-05", "10:00", "aki-main", "s1", null, "Q1", "A1")
    await appendQA(dir, "2026-06-05", "11:00", "aki-main", "s2", null, "Q2", "A2")

    const entries = await readQA(dir, "2026-06-05", { sessionId: "s2", agentName: "aki-main" })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.sessionId).toBe("s2")
  })

  test("parses multi-line Q and A", async () => {
    await appendQA(dir, "2026-06-05", "14:22", "aki-main", "s1", null, "Line 1\nLine 2", "Answer 1\nAnswer 2")

    const entries = await readQA(dir, "2026-06-05")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.question).toBe("Line 1\nLine 2")
    expect(entries[0]!.answer).toBe("Answer 1\nAnswer 2")
  })

  test("backward compat: falls back to old per-session file", async () => {
    // Create an old-format per-session file.
    const sessionsDir = path.join(dir, "sessions")
    const oldPath = path.join(sessionsDir, "qa-memory-ses_old.md")
    await Bun.write(
      oldPath,
      [
        "# Q-A Memory — Session ses_old",
        "",
        "<!-- New Q-A pairs go below this line, newest at the bottom. -->",
        "",
        "**Q:** Old question?",
        "**A:** Old answer.",
        "",
      ].join("\n"),
    )

    const entries = await readQA(dir, "2026-06-05", { sessionId: "ses_old" })
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const found = entries.find((e) => e.question === "Old question?")
    expect(found).toBeDefined()
    expect(found!.answer).toBe("Old answer.")
    expect(found!.sessionId).toBe("ses_old")
  })
})

describe("readPlan", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reminders-reader-plan-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("returns empty array when date file does not exist", async () => {
    const entries = await readPlan(dir, "2026-06-05")
    expect(entries).toEqual([])
  })

  test("parses a single plan entry", async () => {
    await appendPlan(dir, "2026-06-05", "14:22", "aki-main", "ses_abc123", null, [
      "- [completed] Fix P0 timing bug",
      "- [pending] Implement date-based journal",
    ])

    const entries = await readPlan(dir, "2026-06-05")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.time).toBe("14:22")
    expect(entries[0]!.agentName).toBe("aki-main")
    expect(entries[0]!.sessionId).toBe("ses_abc123")
    expect(entries[0]!.parentId).toBeNull()
    expect(entries[0]!.items).toEqual(["- [completed] Fix P0 timing bug", "- [pending] Implement date-based journal"])
  })

  test("parses entry with parent", async () => {
    await appendPlan(dir, "2026-06-05", "14:24", "aki-execute", "ses_def456", "ses_abc123", [
      "- [in_progress] Work item",
    ])

    const entries = await readPlan(dir, "2026-06-05")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.parentId).toBe("ses_abc123")
  })

  test("parses multiple plan entries", async () => {
    await appendPlan(dir, "2026-06-05", "10:00", "aki-main", "s1", null, ["- [pending] Task 1"])
    await appendPlan(dir, "2026-06-05", "11:00", "aki-execute", "s2", "s1", ["- [in_progress] Task 2"])

    const entries = await readPlan(dir, "2026-06-05")
    expect(entries).toHaveLength(2)
    expect(entries[0]!.items[0]).toBe("- [pending] Task 1")
    expect(entries[1]!.items[0]).toBe("- [in_progress] Task 2")
  })

  test("filters by sessionId", async () => {
    await appendPlan(dir, "2026-06-05", "10:00", "aki-main", "s1", null, ["- Task from s1"])
    await appendPlan(dir, "2026-06-05", "11:00", "aki-execute", "s2", "s1", ["- Task from s2"])

    const entries = await readPlan(dir, "2026-06-05", { sessionId: "s2" })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.sessionId).toBe("s2")
  })

  test("filters by agentName", async () => {
    await appendPlan(dir, "2026-06-05", "10:00", "aki-main", "s1", null, ["- T1"])
    await appendPlan(dir, "2026-06-05", "11:00", "aki-execute", "s2", "s1", ["- T2"])

    const entries = await readPlan(dir, "2026-06-05", { agentName: "aki-execute" })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.agentName).toBe("aki-execute")
  })

  test("backward compat: falls back to old per-session todo file", async () => {
    const sessionsDir = path.join(dir, "sessions")
    const oldPath = path.join(sessionsDir, "todo-ses_old.md")
    await Bun.write(
      oldPath,
      [
        "# TODO — Session ses_old",
        "",
        "**Last updated:** yesterday",
        "**Top-level goal:** test",
        "",
        "## Open Questions / Investigating",
        "- What about X?",
        "",
        "## Up Next",
        "- Do task A",
        "- Do task B",
        "",
      ].join("\n"),
    )

    const entries = await readPlan(dir, "2026-06-05", { sessionId: "ses_old" })
    expect(entries.length).toBeGreaterThanOrEqual(1)
    // The old parser groups items under bucket headings.
    const allItems = entries.flatMap((e) => e.items)
    expect(allItems.some((i) => i.includes("What about X"))).toBe(true)
    expect(allItems.some((i) => i.includes("Do task A"))).toBe(true)
  })
})
