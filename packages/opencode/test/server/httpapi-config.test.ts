import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Server } from "../../src/server/server"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

// Points the global config dir at `dir` for the rest of the scope, so agent edits never touch a real config.
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

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
    }),
  )

  it.live(
    "writes agent model overrides to the global config without reloading the instance",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: { formatter: false, lsp: false, agent: { plan: { model: "test/project" } } },
      })
      const global = (yield* tmpdirEffect({})).path
      const file = path.join(global, "opencode.jsonc")
      const project = path.join(tmp.path, "opencode.json")
      yield* Effect.promise(() =>
        Bun.write(file, '{\n  // global\n  "$schema": "https://opencode.ai/config.json"\n}\n'),
      )
      yield* useGlobalConfigDir(global)
      const request = (url: string, init?: { method: string; body: unknown }) =>
        Effect.promise(async () => {
          const response = await app().request(url, {
            method: init?.method,
            headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
            body: init ? JSON.stringify(init.body) : undefined,
          })
          return { status: response.status, body: await response.json() }
        })
      const find = (agents: unknown, name: string) =>
        (agents as Array<{ name: string; model?: unknown; source?: unknown }>).find((agent) => agent.name === name)

      const before = (yield* request("/agent")).body
      expect(find(before, "build")?.source).toEqual({ scope: "builtin" })
      expect(find(before, "plan")?.source).toEqual({ scope: "project", path: project })

      const updated = yield* request("/config/agent", {
        method: "PATCH",
        body: { name: "build", model: "test/model", variant: "max" },
      })
      expect(updated).toEqual({ status: 200, body: { path: file, changed: true } })
      expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(`{
  // global
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "build": {
      "model": "test/model",
      "variant": "max"
    }
  }
}
`)
      expect(yield* Effect.promise(() => Bun.file(project).json())).toMatchObject({
        agent: { plan: { model: "test/project" } },
      })
      expect(yield* Effect.promise(() => Bun.file(project).json())).not.toHaveProperty("agent.build")

      // The project config loads after the global config, so its plan model shadows the new override.
      const shadowed = yield* request("/config/agent", { method: "PATCH", body: { name: "plan", model: "test/other" } })
      expect(shadowed).toEqual({ status: 200, body: { path: file, changed: true, shadowed_by: project } })

      // The running instance keeps its startup agents until opencode restarts.
      const after = find((yield* request("/agent")).body, "build")
      expect(after?.model).toBeUndefined()
      expect(after?.source).toEqual({ scope: "builtin" })

      const missing = yield* request("/config/agent", { method: "PATCH", body: { name: "missing", model: "a/b" } })
      expect(missing).toMatchObject({
        status: 400,
        body: { name: "AgentConfigError", data: { message: 'Agent "missing" not found' } },
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )
})
