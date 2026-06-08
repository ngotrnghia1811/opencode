import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Registry } from "../../../src/agent/_shared/scorer"
import { ReportScorer } from "../../../src/agent/_shared/scorers/aki-sk-report"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

describe("scorer.aki-sk-report", () => {
  it.effect("registers itself under its agent name at module init", () =>
    Effect.gen(function* () {
      expect(ReportScorer.agent).toBe("aki-sk-report")
      expect(Registry.get("aki-sk-report")).toBe(ReportScorer)
    }),
  )

  it.effect("score() returns an empty result set in the skeleton stub", () =>
    Effect.gen(function* () {
      const rows = yield* ReportScorer.score({
        traceFiles: [],
        policyPath: "",
        agent: "aki-sk-report",
      })
      expect(rows).toEqual([])
    }),
  )
})
