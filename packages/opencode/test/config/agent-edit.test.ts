import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ConfigAgentEdit } from "../../src/config/agent-edit"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))

const jsonc = `{
  // project settings
  "$schema": "https://opencode.ai/config.json",
  "theme": "dark", // inline comment
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4", // pinned
      "prompt": "hello",
      "permission": { "edit": "deny" },
    },
    "plan": { "model": "openai/gpt-5" },
  },
  "plugin": ["a", "b"],
}
`

const markdown = `---
description: Reviews code
mode: subagent
model: anthropic/claude-sonnet-4
tools:
  write: false
---
You are a reviewer.

---
model: this line is body text
`

const read = (file: string) => Effect.promise(() => Bun.file(file).text())

describe("ConfigAgentEdit.patchJson", () => {
  test("replaces the model and adds a variant without touching comments or other keys", () => {
    expect(ConfigAgentEdit.patchJson(jsonc, "build", { model: "openai/gpt-5", variant: "high" })).toBe(
      jsonc.replace(
        '      "model": "anthropic/claude-sonnet-4", // pinned\n',
        '      "variant": "high",\n      "model": "openai/gpt-5", // pinned\n',
      ),
    )
  })

  test("removes an override by deleting only its line", () => {
    expect(ConfigAgentEdit.patchJson(jsonc, "build", { model: "" })).toBe(
      jsonc.replace('      "model": "anthropic/claude-sonnet-4", // pinned\n', ""),
    )
  })

  test("drops the separator comma when the removed key was last", () => {
    const text = `{
  "agent": {
    "build": {
      "description": "d", // about build
      "model": "x/y"
    }
  }
}
`
    expect(ConfigAgentEdit.patchJson(text, "build", { model: "" })).toBe(
      text.replace('"d", // about build\n      "model": "x/y"\n', '"d" // about build\n'),
    )
  })

  test("adds an agent that the file does not define and keeps inline siblings", () => {
    expect(ConfigAgentEdit.patchJson(jsonc, "explore", { model: "a/b" })).toBe(
      jsonc.replace('  "agent": {\n', '  "agent": {\n    "explore": {\n      "model": "a/b"\n    },\n'),
    )
  })

  test("adds the agent section after $schema and keeps the other root keys", () => {
    const text = `{
  "$schema": "https://opencode.ai/config.json",
  // plugins
  "plugin": ["a", "b"]
}
`
    expect(ConfigAgentEdit.patchJson(text, "build", { model: "a/b", variant: "max" })).toBe(`{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "build": {
      "model": "a/b",
      "variant": "max"
    }
  },
  // plugins
  "plugin": ["a", "b"]
}
`)
  })

  test("leaves the text unchanged for omitted fields and absent keys", () => {
    expect(ConfigAgentEdit.patchJson(jsonc, "build", {})).toBe(jsonc)
    expect(ConfigAgentEdit.patchJson(jsonc, "general", { model: "", variant: "" })).toBe(jsonc)
  })

  test("patches agents defined under the deprecated mode key", () => {
    const text = `{
  "mode": {
    "review": {
      "model": "a/b"
    }
  }
}
`
    expect(ConfigAgentEdit.patchJson(text, "review", { model: "c/d" })).toBe(text.replace('"a/b"', '"c/d"'))
  })

  test("refuses v2 agents entries and invalid JSON", () => {
    expect(() =>
      ConfigAgentEdit.patchJson('{ "agents": { "review": { "model": "a/b" } } }', "review", { model: "c/d" }),
    ).toThrow('uses the v2 "agents" key')
    expect(() => ConfigAgentEdit.patchJson('{ "agent": ', "build", { model: "c/d" })).toThrow("invalid JSON")
  })
})

describe("ConfigAgentEdit.patchMarkdown", () => {
  test("patches frontmatter keys and keeps the body byte-identical", () => {
    expect(ConfigAgentEdit.patchMarkdown(markdown, { model: "openai/gpt-5", variant: "high" })).toBe(
      markdown.replace("model: anthropic/claude-sonnet-4\n", "model: openai/gpt-5\nvariant: high\n"),
    )
  })

  test("removes an override and leaves absent keys alone", () => {
    expect(ConfigAgentEdit.patchMarkdown(markdown, { model: "" })).toBe(
      markdown.replace("model: anthropic/claude-sonnet-4\n", ""),
    )
    expect(ConfigAgentEdit.patchMarkdown(markdown, { variant: "" })).toBe(markdown)
  })

  test("creates frontmatter when the file has none", () => {
    expect(ConfigAgentEdit.patchMarkdown("Just a prompt\n", { model: "a/b" })).toBe(
      "---\nmodel: a/b\n---\nJust a prompt\n",
    )
    expect(ConfigAgentEdit.patchMarkdown("Just a prompt\n", { model: "" })).toBe("Just a prompt\n")
  })

  test("quotes values that YAML would read as another type", () => {
    expect(ConfigAgentEdit.patchMarkdown(markdown, { model: "openrouter/qwen/qwen3-coder:free", variant: "1" })).toBe(
      markdown.replace("model: anthropic/claude-sonnet-4\n", 'model: openrouter/qwen/qwen3-coder:free\nvariant: "1"\n'),
    )
  })

  test("replaces block scalar values and keeps CRLF line endings", () => {
    expect(ConfigAgentEdit.patchMarkdown("---\nmodel: >-\n  a/b\nmode: primary\n---\nx\n", { model: "c/d" })).toBe(
      "---\nmodel: c/d\nmode: primary\n---\nx\n",
    )
    expect(
      ConfigAgentEdit.patchMarkdown("---\r\nmode: primary\r\nmodel: a/b\r\n---\r\nBody\r\n", {
        model: "c/d",
        variant: "max",
      }),
    ).toBe("---\r\nmode: primary\r\nmodel: c/d\r\nvariant: max\r\n---\r\nBody\r\n")
  })

  test("rejects frontmatter without a closing delimiter", () => {
    expect(() => ConfigAgentEdit.patchMarkdown("---\nmodel: a/b\nbody\n", { model: "c/d" })).toThrow("no closing ---")
  })
})

describe("ConfigAgentEdit.update", () => {
  it.live("writes the tracked markdown source", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, ".opencode", "agent", "review.md")
      yield* FSUtil.use.writeWithDirs(file, markdown)

      const result = yield* ConfigAgentEdit.update({
        name: "review",
        file,
        directory: dir,
        worktree: dir,
        patch: { model: " openai/gpt-5 ", variant: "high" },
      })

      expect(result).toEqual({ path: file, changed: true })
      expect(yield* read(file)).toBe(
        markdown.replace("model: anthropic/claude-sonnet-4\n", "model: openai/gpt-5\nvariant: high\n"),
      )
    }),
  )

  it.live("writes built-in overrides into the existing project config", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "opencode.jsonc")
      yield* FSUtil.use.writeWithDirs(file, '{\n  // mine\n  "theme": "dark"\n}\n')

      const result = yield* ConfigAgentEdit.update({
        name: "build",
        directory: dir,
        worktree: dir,
        patch: { model: "a/b" },
      })

      expect(result).toEqual({ path: file, changed: true })
      expect(yield* read(file)).toBe(
        '{\n  "agent": {\n    "build": {\n      "model": "a/b"\n    }\n  },\n  // mine\n  "theme": "dark"\n}\n',
      )
    }),
  )

  it.live("creates .opencode/opencode.json for built-in overrides when the project has no config", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, ".opencode", "opencode.json")

      const result = yield* ConfigAgentEdit.update({
        name: "title",
        directory: dir,
        worktree: dir,
        patch: { model: "a/b", variant: "low" },
      })

      expect(result).toEqual({ path: file, changed: true })
      expect(yield* read(file)).toBe(`{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "title": {
      "model": "a/b",
      "variant": "low"
    }
  }
}
`)
    }),
  )

  it.live("does not create a config file when removing an override that does not exist", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()

      const result = yield* ConfigAgentEdit.update({
        name: "title",
        directory: dir,
        worktree: dir,
        patch: { model: "", variant: "" },
      })

      expect(result).toEqual({ path: path.join(dir, ".opencode", "opencode.json"), changed: false })
      expect(yield* Effect.promise(() => Bun.file(result.path).exists())).toBe(false)
    }),
  )

  it.live("rejects malformed models and missing source files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const input = { name: "review", directory: dir, worktree: dir }

      const model = yield* ConfigAgentEdit.update({ ...input, patch: { model: "gpt-5" } }).pipe(Effect.flip)
      expect(model.message).toContain("provider/model")

      const file = path.join(dir, "gone.md")
      const missing = yield* ConfigAgentEdit.update({ ...input, file, patch: { model: "a/b" } }).pipe(Effect.flip)
      expect(missing.message).toContain(`Config file ${file} is missing`)
    }),
  )
})
