import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import { VerdictAckTool } from "../../src/tool/verdict-ack"
import { AckSchema } from "../../src/agent/aki-eval/ack-schema"
import { LSP } from "@/lsp/lsp"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Bus } from "../../src/bus"
import { Format } from "../../src/format"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-verdict-ack"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(
    LSP.defaultLayer,
    AppFileSystem.defaultLayer,
    Bus.layer,
    Format.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const run = Effect.fn("VerdictAckToolTest.run")(function* (
  args: Tool.InferParameters<typeof VerdictAckTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* (yield* VerdictAckTool).init()
  return yield* tool.execute(args, next)
})

describe("tool.verdict_ack", () => {
  it.instance("writes ack co-located with existing verdict file", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const verdictDir = path.join(test.directory, ".opencode", "aki-eval")
      yield* Effect.promise(() => fs.mkdir(verdictDir, { recursive: true }))
      yield* Effect.promise(() =>
        fs.writeFile(path.join(verdictDir, "verdict-1234.yaml"), "verdict: pass\n", "utf-8"),
      )

      const result = yield* run({ verdict_id: "1234", finding_id: "F-001", status: "accept" })

      expect(result.metadata.path).toBe(path.join(verdictDir, "ack-1234.yaml"))
      const raw = yield* Effect.promise(() => fs.readFile(result.metadata.path, "utf-8"))
      const parsed = YAML.parse(raw) as AckSchema.AckFile
      expect(parsed.verdict_id).toBe("1234")
      expect(parsed.acks).toHaveLength(1)
      expect(parsed.acks[0].finding_id).toBe("F-001")
      expect(parsed.acks[0].status).toBe("accept")
    }),
  )

  it.instance("merges multiple acks and replaces by finding_id", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const verdictDir = path.join(test.directory, ".opencode", "aki-eval")
      yield* Effect.promise(() => fs.mkdir(verdictDir, { recursive: true }))
      yield* Effect.promise(() =>
        fs.writeFile(path.join(verdictDir, "verdict-5678.yaml"), "verdict: fail\n", "utf-8"),
      )

      yield* run({ verdict_id: "5678", finding_id: "F-001", status: "accept" })
      yield* run({ verdict_id: "5678", finding_id: "F-002", status: "dismiss", note: "false positive" })
      const last = yield* run({ verdict_id: "5678", finding_id: "F-001", status: "fixed" })

      const parsed = YAML.parse(
        yield* Effect.promise(() => fs.readFile(last.metadata.path, "utf-8")),
      ) as AckSchema.AckFile
      expect(parsed.acks).toHaveLength(2)
      const f1 = parsed.acks.find((a) => a.finding_id === "F-001")!
      const f2 = parsed.acks.find((a) => a.finding_id === "F-002")!
      expect(f1.status).toBe("fixed")
      expect(f2.status).toBe("dismiss")
      expect(f2.note).toBe("false positive")
    }),
  )

  it.instance("falls back to default verdict dir when verdict file missing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const result = yield* run({ verdict_id: "9999", finding_id: "F-001", status: "dismiss" })
      const expectedDir = path.join(test.directory, ".opencode", "aki-eval")
      expect(result.metadata.path).toBe(path.join(expectedDir, "ack-9999.yaml"))
    }),
  )
})
