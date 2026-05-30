import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Rule } from "../src/config.ts"
import { ensureFilesForRule } from "../src/helpers.ts"

// A Rule only needs `ensure` (plus the required base fields) for these
// tests; trigger/file are never read by ensureFilesForRule.
function ruleWithEnsure(ensure: Rule["ensure"]): Rule {
  return { trigger: "every:turn:*", file: "ignored.md", ensure }
}

describe("ensureFilesForRule", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reminders-ensure-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("creates a missing file with the templated header", async () => {
    const rule = ruleWithEnsure([{ path: "qa-memory.md", header: "# QA Memory\n" }])
    await ensureFilesForRule(rule, dir, {})

    const abs = path.join(dir, "qa-memory.md")
    expect(await Bun.file(abs).exists()).toBe(true)
    expect(await Bun.file(abs).text()).toBe("# QA Memory\n")
  })

  test("is idempotent: does not overwrite an existing file", async () => {
    const abs = path.join(dir, "todo.md")
    await Bun.write(abs, "custom user content")

    const rule = ruleWithEnsure([{ path: "todo.md", header: "# seeded header" }])
    await ensureFilesForRule(rule, dir, {})

    expect(await Bun.file(abs).text()).toBe("custom user content")
  })

  test("substitutes {sessionID} in both path and header", async () => {
    const rule = ruleWithEnsure([{ path: "qa-memory-{sessionID}.md", header: "# session {sessionID}\n" }])
    await ensureFilesForRule(rule, dir, { sessionID: "ses_abc" })

    const abs = path.join(dir, "qa-memory-ses_abc.md")
    expect(await Bun.file(abs).exists()).toBe(true)
    expect(await Bun.file(abs).text()).toBe("# session ses_abc\n")
  })

  test("missing header creates an empty file", async () => {
    const rule = ruleWithEnsure([{ path: "empty.md" }])
    await ensureFilesForRule(rule, dir, {})

    const abs = path.join(dir, "empty.md")
    expect(await Bun.file(abs).exists()).toBe(true)
    expect(await Bun.file(abs).text()).toBe("")
  })

  test("unresolved token in path skips creation", async () => {
    const rule = ruleWithEnsure([{ path: "qa-{sessionID}.md", header: "x" }])
    await ensureFilesForRule(rule, dir, {})

    expect(await Bun.file(path.join(dir, "qa-{sessionID}.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(dir, "qa-.md")).exists()).toBe(false)
  })

  test("unresolved token in header skips creation", async () => {
    const rule = ruleWithEnsure([{ path: "ok.md", header: "agent={agent}" }])
    await ensureFilesForRule(rule, dir, { sessionID: "s" })

    expect(await Bun.file(path.join(dir, "ok.md")).exists()).toBe(false)
  })

  test("auto-creates parent directories for a nested path", async () => {
    const rule = ruleWithEnsure([{ path: "nested/sub/notes.md", header: "# nested\n" }])
    await ensureFilesForRule(rule, dir, {})

    const abs = path.join(dir, "nested", "sub", "notes.md")
    expect(await Bun.file(abs).exists()).toBe(true)
    expect(await Bun.file(abs).text()).toBe("# nested\n")
  })

  test("no-op when rule has no ensure list", async () => {
    const rule: Rule = { trigger: "every:turn:*", file: "ignored.md" }
    await ensureFilesForRule(rule, dir, {})
    // nothing to assert beyond not throwing; directory stays empty
    expect(await Bun.file(path.join(dir, "anything.md")).exists()).toBe(false)
  })

  test("handles multiple ensure entries independently", async () => {
    const rule = ruleWithEnsure([
      { path: "a.md", header: "AAA" },
      { path: "b-{sessionID}.md" },
    ])
    await ensureFilesForRule(rule, dir, { sessionID: "ses_x" })

    expect(await Bun.file(path.join(dir, "a.md")).text()).toBe("AAA")
    expect(await Bun.file(path.join(dir, "b-ses_x.md")).text()).toBe("")
  })

  test("absolute path is honored as-is", async () => {
    const abs = path.join(dir, "abs.md")
    const rule = ruleWithEnsure([{ path: abs, header: "# abs\n" }])
    await ensureFilesForRule(rule, "/nonexistent-base", {})

    expect(await Bun.file(abs).exists()).toBe(true)
    expect(await Bun.file(abs).text()).toBe("# abs\n")
  })
})
