import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { ConfigAgent } from "../../src/config/agent"
import { ConfigAgentEdit } from "../../src/config/agent-edit"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))

// Points the global config dir at a scoped temp dir for the rest of the scope. ConfigAgentEdit.update resolves its
// target from Global.Path.config on every call.
const globalConfigDir = Effect.gen(function* () {
  const dir = yield* tmpdirScoped()
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Global.Path.config
      ;(Global.Path as { config: string }).config = dir
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        ;(Global.Path as { config: string }).config = previous
      }),
  )
  return dir
})

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

describe("ConfigAgentEdit.update", () => {
  it.live("writes into the highest-precedence global config file and keeps its comments", () =>
    Effect.gen(function* () {
      const dir = yield* globalConfigDir
      const legacy = path.join(dir, "config.json")
      const file = path.join(dir, "opencode.jsonc")
      yield* FSUtil.use.writeWithDirs(legacy, '{\n  "username": "legacy"\n}\n')
      yield* FSUtil.use.writeWithDirs(
        file,
        '{\n  // mine\n  "$schema": "https://opencode.ai/config.json",\n  "username": "me"\n}\n',
      )

      const result = yield* ConfigAgentEdit.update({
        name: "build",
        patch: { model: " openai/gpt-5 ", variant: "high" },
      })

      // toStrictEqual also proves that the key is absent, because the HTTP encoder sends an undefined value as null.
      expect(result).toStrictEqual({ path: file, changed: true })
      expect(yield* read(file)).toBe(`{
  // mine
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "build": {
      "model": "openai/gpt-5",
      "variant": "high"
    }
  },
  "username": "me"
}
`)
      expect(yield* read(legacy)).toBe('{\n  "username": "legacy"\n}\n')
    }),
  )

  it.live("creates a global opencode.json when no global config file exists", () =>
    Effect.gen(function* () {
      const dir = yield* globalConfigDir
      const file = path.join(dir, "opencode.json")

      const result = yield* ConfigAgentEdit.update({
        name: "title",
        patch: { model: "a/b", variant: "low" },
      })

      expect(result).toStrictEqual({ path: file, changed: true })
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

  it.live("does not create a global config file when removing an override that does not exist", () =>
    Effect.gen(function* () {
      const dir = yield* globalConfigDir

      const result = yield* ConfigAgentEdit.update({
        name: "title",
        patch: { model: "", variant: "" },
      })

      expect(result).toStrictEqual({ path: path.join(dir, "opencode.json"), changed: false })
      expect(yield* Effect.promise(() => Bun.file(result.path).exists())).toBe(false)
    }),
  )

  it.live("reports a later config layer that sets a patched field", () =>
    Effect.gen(function* () {
      const dir = yield* globalConfigDir
      const project = yield* tmpdirScoped()
      const file = path.join(dir, "opencode.json")
      const projectFile = path.join(project, "opencode.json")
      const globalMarkdown = path.join(dir, "agent", "review.md")
      yield* FSUtil.use.writeWithDirs(file, "{}\n")
      const update = (patch: ConfigAgentEdit.Patch, origin: ConfigAgent.Origin) =>
        ConfigAgentEdit.update({ name: "review", patch, origin }).pipe(Effect.map((result) => result.shadowed_by))

      // The project file sets the model only, so it shadows a model edit but not a variant edit.
      const origin = ConfigAgent.origin(projectFile, { model: "x/project" })
      expect(yield* update({ model: "a/b" }, origin)).toBe(projectFile)
      expect(yield* update({ variant: "max" }, origin)).toBeUndefined()
      // Markdown agents in the global config dir load after every JSON file, so they shadow the global JSON too.
      expect(yield* update({ model: "c/d" }, ConfigAgent.origin(globalMarkdown, { model: "x/markdown" }))).toBe(
        globalMarkdown,
      )
      // A value from the global JSON file itself never shadows the write.
      expect(yield* update({ model: "e/f" }, ConfigAgent.origin(file, { model: "x/global" }))).toBeUndefined()
      // Shadowed edits are still written, so they apply once the shadowing file drops the field.
      expect(JSON.parse(yield* read(file))).toEqual({ agent: { review: { model: "e/f", variant: "max" } } })
    }),
  )

  it.live("rejects malformed models", () =>
    Effect.gen(function* () {
      yield* globalConfigDir

      const error = yield* ConfigAgentEdit.update({ name: "review", patch: { model: "gpt-5" } }).pipe(Effect.flip)
      expect(error.message).toContain("provider/model")
    }),
  )
})
