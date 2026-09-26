import { afterEach, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { disposeAllInstances, TestInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Skill } from "../../src/skill"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Agent.node, Plugin.node, Provider.node, Auth.node, Config.node, Skill.node, RuntimeFlags.node]),
    [[RuntimeFlags.node, RuntimeFlags.layer({})]],
  ),
)

afterEach(async () => {
  await disposeAllInstances()
})

const write = (file: string, text: string) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, text)
  })

const sources = Effect.gen(function* () {
  const agents = yield* Agent.Service.use((svc) => svc.list())
  return Object.fromEntries(agents.map((agent) => [agent.name, agent.source]))
})

// Points the global config dir at `dir` for the rest of the scope. Each test builds a fresh Config service, so the
// global config is read from `dir` on first use.
const useGlobalConfigDir = (dir: string) =>
  Effect.acquireRelease(
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

it.instance("marks agents without a config file as built-in", () =>
  Effect.gen(function* () {
    const result = yield* sources
    expect(result.build).toEqual({ scope: "builtin" })
    expect(result.compaction).toEqual({ scope: "builtin" })
    // Bundled markdown agents from src/agent/builtin are not user config.
    expect(result["aki-main"]).toEqual({ scope: "builtin" })
  }),
)

it.instance(
  "tracks project JSON and markdown sources",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const result = yield* sources
      expect(result.build).toEqual({ scope: "project", path: path.join(test.directory, "opencode.json") })
      expect(result.helper).toEqual({
        scope: "project",
        path: path.join(test.directory, ".opencode", "agent", "helper.md"),
      })
    }),
  {
    config: { agent: { build: { model: "test/model" } } },
    init: (dir) =>
      write(
        path.join(dir, ".opencode", "agent", "helper.md"),
        "---\nmodel: test/helper\nmode: subagent\n---\nHelper prompt\n",
      ),
  },
)

it.instance(
  "reports the layer that sets model or variant over later layers that only mention the agent",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const result = yield* sources
      // .opencode/opencode.json loads after opencode.json but only sets temperature for build.
      expect(result.build).toEqual({ scope: "project", path: path.join(test.directory, "opencode.json") })
      // Without model or variant anywhere, the highest-precedence mention wins.
      expect(result.general).toEqual({
        scope: "project",
        path: path.join(test.directory, ".opencode", "opencode.json"),
      })
      // Markdown agents load after JSON files, so the markdown model wins.
      expect(result.review).toEqual({
        scope: "project",
        path: path.join(test.directory, ".opencode", "agent", "review.md"),
      })
    }),
  {
    config: {
      agent: {
        build: { model: "test/model" },
        general: { temperature: 0.1 },
        review: { model: "test/json", mode: "subagent" },
      },
    },
    init: (dir) =>
      Effect.all([
        write(
          path.join(dir, ".opencode", "opencode.json"),
          JSON.stringify({ agent: { build: { temperature: 0.2 }, general: { temperature: 0.3 } } }),
        ),
        write(path.join(dir, ".opencode", "agent", "review.md"), "---\nmodel: test/markdown\n---\nReview prompt\n"),
      ]).pipe(Effect.asVoid),
  },
)

it.instance(
  "tracks the highest-precedence file for each of model and variant",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cfg = yield* Config.Service.use((svc) => svc.get())
      // .opencode/opencode.json loads after opencode.json and sets only the variant.
      expect(cfg.agent_origins?.build).toEqual({
        file: path.join(test.directory, ".opencode", "opencode.json"),
        value: path.join(test.directory, ".opencode", "opencode.json"),
        model: path.join(test.directory, "opencode.json"),
        variant: path.join(test.directory, ".opencode", "opencode.json"),
      })
    }),
  {
    config: { agent: { build: { model: "test/model" } } },
    init: (dir) =>
      write(path.join(dir, ".opencode", "opencode.json"), JSON.stringify({ agent: { build: { variant: "high" } } })),
  },
)

it.instance("classifies files in the global config dir as global", () =>
  Effect.gen(function* () {
    const global = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(Effect.map((tmp) => tmp.path))
    yield* write(path.join(global, "opencode.json"), JSON.stringify({ agent: { plan: { variant: "high" } } }))
    yield* write(path.join(global, "agent", "roamer.md"), "---\nmode: subagent\n---\nRoamer prompt\n")
    yield* useGlobalConfigDir(global)

    const result = yield* sources
    expect(result.plan).toEqual({ scope: "global", path: path.join(global, "opencode.json") })
    expect(result.roamer).toEqual({ scope: "global", path: path.join(global, "agent", "roamer.md") })
  }),
)

it.instance("keeps a global config dir inside the project classified as global", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    // Mirrors a workspace that points XDG_CONFIG_HOME at a folder inside the project checkout.
    const global = path.join(test.directory, ".opencode-workspace", "config", "opencode")
    yield* write(path.join(global, "opencode.json"), JSON.stringify({ agent: { explore: { model: "test/explore" } } }))
    yield* useGlobalConfigDir(global)

    const result = yield* sources
    expect(result.explore).toEqual({ scope: "global", path: path.join(global, "opencode.json") })
  }),
)
