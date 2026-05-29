import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearCache, readCached } from "../src/file-cache.ts"

let dir = ""

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "reminders-cache-"))
  clearCache()
})

afterEach(async () => {
  clearCache()
  await rm(dir, { recursive: true, force: true })
})

describe("readCached", () => {
  test("returns undefined for non-existent file", async () => {
    const result = await readCached(join(dir, "missing.md"))
    expect(result).toBeUndefined()
  })

  test("reads existing file and reports it as not truncated", async () => {
    const path = join(dir, "hello.md")
    await writeFile(path, "hello world")
    const result = await readCached(path)
    expect(result).toBeDefined()
    expect(result!.text).toBe("hello world")
    expect(result!.truncated).toBe(false)
    expect(result!.path).toBe(path)
  })

  test("serves cached content on second read when file unchanged", async () => {
    const path = join(dir, "stable.md")
    await writeFile(path, "first")
    const a = await readCached(path)
    // Mutate the file via a different API would change size+mtime; instead
    // verify that an unmodified file produces an identical-text result that
    // exercises the cache hit branch (mtime+size match).
    const b = await readCached(path)
    expect(b!.text).toBe(a!.text)
    expect(b!.path).toBe(path)
  })

  test("re-reads when file size changes", async () => {
    const path = join(dir, "growing.md")
    await writeFile(path, "v1")
    const a = await readCached(path)
    expect(a!.text).toBe("v1")
    // Wait a millisecond so mtime advances on filesystems with coarse mtime
    // resolution; size change alone also invalidates the cache key.
    await Bun.sleep(10)
    await writeFile(path, "v2 longer content")
    const b = await readCached(path)
    expect(b!.text).toBe("v2 longer content")
  })

  test("appends truncation marker when size exceeds maxBytes", async () => {
    const path = join(dir, "big.md")
    const body = "x".repeat(200)
    await writeFile(path, body)
    const result = await readCached(path, 50)
    expect(result).toBeDefined()
    expect(result!.truncated).toBe(true)
    expect(result!.text.startsWith("x".repeat(50))).toBe(true)
    expect(result!.text).toContain("[reminders: file truncated at 50 bytes]")
  })

  test("clearCache forces a re-read", async () => {
    const path = join(dir, "cleared.md")
    await writeFile(path, "one")
    const a = await readCached(path)
    expect(a!.text).toBe("one")
    clearCache()
    // After clearing, the next call must hit the read path again and still
    // return correct content (regression check).
    const b = await readCached(path)
    expect(b!.text).toBe("one")
  })
})
