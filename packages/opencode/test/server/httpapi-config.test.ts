import { afterEach, describe, expect } from "bun:test"
import path from "path"
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
    "writes agent model overrides without reloading the instance",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const request = (url: string, init?: { method: string; body: unknown }) =>
        Effect.promise(async () => {
          const response = await app().request(url, {
            method: init?.method,
            headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
            body: init ? JSON.stringify(init.body) : undefined,
          })
          return { status: response.status, body: await response.json() }
        })
      const build = (agents: unknown) =>
        (agents as Array<{ name: string; model?: unknown; source?: unknown }>).find((agent) => agent.name === "build")

      expect(build((yield* request("/agent")).body)?.source).toEqual({ scope: "builtin" })

      const updated = yield* request("/config/agent", {
        method: "PATCH",
        body: { name: "build", model: "test/model", variant: "max" },
      })
      expect(updated).toEqual({ status: 200, body: { path: path.join(tmp.path, "opencode.json"), changed: true } })
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "opencode.json")).json())).toMatchObject({
        formatter: false,
        lsp: false,
        agent: { build: { model: "test/model", variant: "max" } },
      })

      // The running instance keeps its startup agents until opencode restarts.
      const after = build((yield* request("/agent")).body)
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
