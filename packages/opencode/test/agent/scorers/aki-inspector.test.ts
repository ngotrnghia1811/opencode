import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Registry } from "../../../src/agent/_shared/scorer"
import { InspectionScorer } from "../../../src/agent/_shared/scorers/aki-inspector"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

describe("scorer.aki-inspector", () => {
  it.effect("registers itself under its agent name at module init", () =>
    Effect.gen(function* () {
      expect(InspectionScorer.agent).toBe("aki-inspector")
      expect(Registry.get("aki-inspector")).toBe(InspectionScorer)
    }),
  )

  it.effect("score() returns an empty result set in the skeleton stub", () =>
    Effect.gen(function* () {
      const rows = yield* InspectionScorer.score({
        traceFiles: [],
        policyPath: "",
        agent: "aki-inspector",
      })
      expect(rows).toEqual([])
    }),
  )
})
