import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Registry } from "../../../src/agent/_shared/scorer"
import { WatchScorer } from "../../../src/agent/_shared/scorers/aki-sk-watch"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

describe("scorer.aki-sk-watch", () => {
  it.effect("registers itself under its agent name at module init", () =>
    Effect.gen(function* () {
      expect(WatchScorer.agent).toBe("aki-sk-watch")
      expect(Registry.get("aki-sk-watch")).toBe(WatchScorer)
    }),
  )

  it.effect("score() returns an empty result set in the skeleton stub", () =>
    Effect.gen(function* () {
      const rows = yield* WatchScorer.score({
        traceFiles: [],
        policyPath: "",
        agent: "aki-sk-watch",
      })
      expect(rows).toEqual([])
    }),
  )
})
