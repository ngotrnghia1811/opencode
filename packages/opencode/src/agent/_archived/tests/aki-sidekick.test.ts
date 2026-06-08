import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Registry } from "../../../src/agent/_shared/scorer"
import { SidekickScorer } from "../../../src/agent/_shared/scorers/aki-sidekick"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

describe("scorer.aki-sidekick", () => {
  it.effect("registers itself under its agent name at module init", () =>
    Effect.gen(function* () {
      expect(SidekickScorer.agent).toBe("aki-sidekick")
      expect(Registry.get("aki-sidekick")).toBe(SidekickScorer)
    }),
  )

  it.effect("score() returns an empty result set in the skeleton stub", () =>
    Effect.gen(function* () {
      const rows = yield* SidekickScorer.score({
        traceFiles: [],
        policyPath: "",
        agent: "aki-sidekick",
      })
      expect(rows).toEqual([])
    }),
  )
})
