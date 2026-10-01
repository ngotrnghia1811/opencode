import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { ConfigPermissionEdit } from "../../src/config/permission-edit"
import { Permission } from "../../src/permission"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))

// Points the global config dir at a scoped temp dir for the rest of the scope.
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

const action = (text: string, permission: string, pattern: string) =>
  Permission.evaluate(permission, pattern, Permission.fromConfig(JSON.parse(text).permission)).action

describe("ConfigPermissionEdit.patchJson", () => {
  test("adds a rule when the config has no permission key", () => {
    const text = ConfigPermissionEdit.patchJson('{\n  "model": "a/b"\n}\n', "bash", ["git status *"])
    expect(JSON.parse(text)).toEqual({ model: "a/b", permission: { bash: { "git status *": "allow" } } })
  })

  test("expands a tool action string so the new pattern wins over it", () => {
    const text = ConfigPermissionEdit.patchJson('{ "permission": { "bash": "ask" } }', "bash", ["git log *"])
    expect(JSON.parse(text).permission.bash).toEqual({ "*": "ask", "git log *": "allow" })
    expect(action(text, "bash", "git log --oneline")).toBe("allow")
    expect(action(text, "bash", "rm -rf x")).toBe("ask")
  })

  test("expands a top-level action string", () => {
    const text = ConfigPermissionEdit.patchJson('{ "permission": "ask" }', "edit", ["src/*"])
    expect(JSON.parse(text).permission).toEqual({ "*": "ask", edit: { "src/*": "allow" } })
    expect(action(text, "edit", "src/a.ts")).toBe("allow")
    expect(action(text, "bash", "ls")).toBe("ask")
  })

  test("moves an existing ask pattern after broader rules", () => {
    const text = ConfigPermissionEdit.patchJson(
      '{ "permission": { "bash": { "git push *": "ask", "*": "deny" } } }',
      "bash",
      ["git push *"],
    )
    expect(Object.entries(JSON.parse(text).permission.bash)).toEqual([
      ["*", "deny"],
      ["git push *", "allow"],
    ])
    expect(action(text, "bash", "git push origin dev")).toBe("allow")
  })

  test("writes an action string for a wildcard request", () => {
    const text = ConfigPermissionEdit.patchJson('{ "permission": { "webfetch": "ask" } }', "webfetch", ["*"])
    expect(JSON.parse(text).permission).toEqual({ webfetch: "allow" })
  })

  test("keeps comments and leaves an allowed pattern unchanged", () => {
    const source = '{\n  // keep\n  "permission": { "bash": { "ls *": "allow" } }\n}\n'
    expect(ConfigPermissionEdit.patchJson(source, "bash", ["ls *"])).toBe(source)
    expect(ConfigPermissionEdit.patchJson(source, "bash", ["pwd *"])).toContain("// keep")
  })

  test("rejects invalid JSON", () => {
    expect(() => ConfigPermissionEdit.patchJson("{ nope", "bash", ["ls *"])).toThrow("invalid JSON")
  })
})

describe("ConfigPermissionEdit.allow", () => {
  it.live("writes the highest-precedence global config file", () =>
    Effect.gen(function* () {
      const dir = yield* globalConfigDir
      const file = path.join(dir, "opencode.json")
      yield* Effect.promise(() => Bun.write(file, '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'))
      const result = yield* ConfigPermissionEdit.allow({ permission: "bash", patterns: ["git status *"] })
      expect(result).toEqual({ path: file, changed: true })
      expect(yield* Effect.promise(() => Bun.file(file).json())).toEqual({
        $schema: "https://opencode.ai/config.json",
        permission: { bash: { "git status *": "allow" } },
      })
      const again = yield* ConfigPermissionEdit.allow({ permission: "bash", patterns: ["git status *"] })
      expect(again).toEqual({ path: file, changed: false })
    }),
  )

  it.live("creates a global opencode.json when no global file exists", () =>
    Effect.gen(function* () {
      const dir = yield* globalConfigDir
      const result = yield* ConfigPermissionEdit.allow({ permission: "read", patterns: ["/tmp/*"] })
      expect(result).toEqual({ path: path.join(dir, "opencode.json"), changed: true })
    }),
  )

  it.live("fails without patterns", () =>
    Effect.gen(function* () {
      yield* globalConfigDir
      const error = yield* ConfigPermissionEdit.allow({ permission: "bash", patterns: [" "] }).pipe(Effect.flip)
      expect(error.message).toBe("At least one pattern is required")
    }),
  )
})
