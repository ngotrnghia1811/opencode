import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Registry } from "../../../src/agent/_shared/scorer"
import { SpecScorer } from "../../../src/agent/_shared/scorers/aki-sk-spec"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

describe("scorer.aki-sk-spec", () => {
  it.effect("registers itself under its agent name at module init", () =>
    Effect.gen(function* () {
      expect(SpecScorer.agent).toBe("aki-sk-spec")
      expect(Registry.get("aki-sk-spec")).toBe(SpecScorer)
    }),
  )

  it.effect("score() returns an empty result set in the skeleton stub", () =>
    Effect.gen(function* () {
      const rows = yield* SpecScorer.score({
        traceFiles: [],
        policyPath: "",
        agent: "aki-sk-spec",
      })
      expect(rows).toEqual([])
    }),
  )
})
