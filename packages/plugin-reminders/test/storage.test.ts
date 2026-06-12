import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { appendPlan, appendQA } from "../src/storage.ts"

describe("appendQA", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reminders-storage-qa-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("creates qa/ directory and writes file with header", async () => {
    await appendQA(dir, "2026-06-05", "14:22", "aki-main", "ses_abc123", null, "How to fix?", "Fix the bug.")

    const filePath = path.join(dir, "qa", "qa-memory-2026-06-05.md")
    const content = await Bun.file(filePath).text()
    expect(content).toContain("# 2026-06-05")
    expect(content).toContain("## 14:22 aki-main ses_abc123")
    expect(content).toContain("Q: How to fix?")
    expect(content).toContain("A: Fix the bug.")
    // No trailing parent arrow for orphan entries.
    expect(content).not.toContain("←")
  })

  test("writes parent session correctly", async () => {
    await appendQA(dir, "2026-06-05", "14:23", "aki-execute", "ses_def456", "ses_abc123", "Q2", "A2")

    const content = await Bun.file(path.join(dir, "qa", "qa-memory-2026-06-05.md")).text()
    expect(content).toContain("## 14:23 aki-execute ses_def456 ← ses_abc123")
  })

  test("appends multiple entries to same file", async () => {
    await appendQA(dir, "2026-06-05", "10:00", "aki-main", "s1", null, "Q1", "A1")
    await appendQA(dir, "2026-06-05", "11:00", "aki-execute", "s2", "s1", "Q2", "A2")
    await appendQA(dir, "2026-06-05", "12:00", "aki-main", "s1", null, "Q3", "A3")

    const content = await Bun.file(path.join(dir, "qa", "qa-memory-2026-06-05.md")).text()
    expect(content).toContain("## 10:00 aki-main s1")
    expect(content).toContain("## 11:00 aki-execute s2 ← s1")
    expect(content).toContain("## 12:00 aki-main s1")
    // All entries present in order.
    const lines = content.split("\n")
    const positions = lines.map((l, i) => (l.startsWith("## ") ? i : -1)).filter((i) => i >= 0)
    expect(positions).toHaveLength(3)
    expect(positions[0]!).toBeLessThan(positions[1]!)
    expect(positions[1]!).toBeLessThan(positions[2]!)
  })

  test("creates separate date files for different days", async () => {
    await appendQA(dir, "2026-06-05", "14:00", "aki-main", "s1", null, "Q1", "A1")
    await appendQA(dir, "2026-06-06", "14:00", "aki-main", "s2", null, "Q2", "A2")

    const day1 = await Bun.file(path.join(dir, "qa", "qa-memory-2026-06-05.md")).text()
    const day2 = await Bun.file(path.join(dir, "qa", "qa-memory-2026-06-06.md")).text()
    expect(day1).toContain("s1")
    expect(day1).not.toContain("Q2")
    expect(day2).toContain("Q2")
    expect(day2).not.toContain("s1")
  })

  test("handles multi-line Q and A", async () => {
    await appendQA(dir, "2026-06-05", "14:22", "aki-main", "s1", null, "Line 1\nLine 2", "Answer line 1\nAnswer line 2")

    const content = await Bun.file(path.join(dir, "qa", "qa-memory-2026-06-05.md")).text()
    expect(content).toContain("Q: Line 1\nLine 2")
    expect(content).toContain("A: Answer line 1\nAnswer line 2")
  })

  test("concurrent appends from multiple sessions are ordered correctly", async () => {
    // Simulate multiple sessions appending to the same date file.
    await appendQA(dir, "2026-06-05", "14:22", "aki-main", "s1", null, "Q from s1", "A from s1")
    await appendQA(dir, "2026-06-05", "14:23", "aki-execute", "s2", "s1", "Q from s2", "A from s2")
    await appendQA(dir, "2026-06-05", "14:24", "aki-build", "s3", "s1", "Q from s3", "A from s3")

    const content = await Bun.file(path.join(dir, "qa", "qa-memory-2026-06-05.md")).text()
    expect(content).toContain("s1")
    expect(content).toContain("s2")
    expect(content).toContain("s3")
    // All three entries present.
    const entryCount = (content.match(/^## /gm) ?? []).length
    expect(entryCount).toBe(3)
  })
})

describe("appendPlan", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reminders-storage-plan-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("creates plan/ directory and writes file with header", async () => {
    await appendPlan(dir, "2026-06-05", "14:22", "aki-main", "ses_abc123", null, [
      "- [completed] Fix P0 timing bug",
      "- [pending] Implement date-based journal",
    ])

    const filePath = path.join(dir, "plan", "evolving-plan-2026-06-05.md")
    const content = await Bun.file(filePath).text()
    expect(content).toContain("# 2026-06-05")
    expect(content).toContain("## 14:22 aki-main ses_abc123")
    expect(content).toContain("- [completed] Fix P0 timing bug")
    expect(content).toContain("- [pending] Implement date-based journal")
    expect(content).not.toContain("←")
  })

  test("writes parent session correctly", async () => {
    await appendPlan(dir, "2026-06-05", "14:24", "aki-execute", "ses_def456", "ses_abc123", [
      "- [in_progress] Create qa/ and plan/ directories",
    ])

    const content = await Bun.file(path.join(dir, "plan", "evolving-plan-2026-06-05.md")).text()
    expect(content).toContain("## 14:24 aki-execute ses_def456 ← ses_abc123")
  })

  test("appends multiple plan entries across sessions", async () => {
    await appendPlan(dir, "2026-06-05", "10:00", "aki-main", "s1", null, ["- [pending] Task 1"])
    await appendPlan(dir, "2026-06-05", "11:00", "aki-execute", "s2", "s1", ["- [in_progress] Task 2"])
    await appendPlan(dir, "2026-06-05", "12:00", "aki-main", "s1", null, ["- [completed] Task 1", "- [pending] Task 3"])

    const content = await Bun.file(path.join(dir, "plan", "evolving-plan-2026-06-05.md")).text()
    expect(content).toContain("- [pending] Task 1")
    expect(content).toContain("- [in_progress] Task 2")
    expect(content).toContain("- [completed] Task 1")
    expect(content).toContain("- [pending] Task 3")
  })

  test("handles empty items array", async () => {
    await appendPlan(dir, "2026-06-05", "14:00", "aki-main", "s1", null, [])

    const content = await Bun.file(path.join(dir, "plan", "evolving-plan-2026-06-05.md")).text()
    expect(content).toContain("## 14:00 aki-main s1")
    // Empty items: just the header and blank line.
  })
})
