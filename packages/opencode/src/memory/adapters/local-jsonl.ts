import { Effect } from "effect"
import path from "path"
import os from "os"
import { OrchestratorMetaSchema } from "../orchestrator-meta-schema"

const dataDir = path.join(os.homedir(), ".local", "share", "opencode", "aki-agents")
const variantsPath = path.join(dataDir, "variants.jsonl")
const runsPath = path.join(dataDir, "runs.jsonl")

const ensureDir = Effect.promise(async () => {
  const fs = await import("fs/promises")
  await fs.mkdir(dataDir, { recursive: true })
})

const readVariants = Effect.promise(async () => {
  const fs = await import("fs/promises")
  const content = await fs.readFile(variantsPath, "utf8").catch(() => "")
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OrchestratorMetaSchema.VariantEntity)
})

const readRuns = Effect.promise(async () => {
  const fs = await import("fs/promises")
  const content = await fs.readFile(runsPath, "utf8").catch(() => "")
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OrchestratorMetaSchema.RunOutcome)
})

const jaccard = (a: string, b: string) => {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  const inter = [...tokensA].filter((t) => tokensB.has(t)).length
  const union = new Set([...tokensA, ...tokensB]).size
  return union === 0 ? 0 : inter / union
}

export const recordVariant = (variant: OrchestratorMetaSchema.VariantEntity) =>
  Effect.gen(function* () {
    yield* ensureDir
    yield* Effect.promise(async () => {
      const fs = await import("fs/promises")
      await fs.appendFile(variantsPath, JSON.stringify(variant) + "\n", "utf-8")
    })
  })

export const recordRun = (run: OrchestratorMetaSchema.RunOutcome) =>
  Effect.gen(function* () {
    yield* ensureDir
    yield* Effect.promise(async () => {
      const fs = await import("fs/promises")
      await fs.appendFile(runsPath, JSON.stringify(run) + "\n", "utf-8")
    })
  })

export const findSimilarVariants = (taskShape: string, topK?: number) =>
  Effect.gen(function* () {
    const variants = yield* readVariants
    const k = topK ?? 5
    return variants
      .map((v) => ({ variant: v, similarity: jaccard(taskShape, v.task_shape) }))
      .filter((s) => s.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k)
  })

export const bestVariantFor = (taskClass: string) =>
  Effect.gen(function* () {
    const runs = yield* readRuns
    const variants = yield* readVariants
    const variantScores = new Map<string, { totalScore: number; count: number }>()
    runs
      .filter((r) => r.task.toLowerCase().includes(taskClass.toLowerCase()))
      .forEach((r) => {
        const existing = variantScores.get(r.variant_id) ?? { totalScore: 0, count: 0 }
        variantScores.set(r.variant_id, {
          totalScore: existing.totalScore + r.success_score,
          count: existing.count + 1,
        })
      })
    const ranked = [...variantScores.entries()]
      .map(([variant_id, s]) => ({ variant_id, avg_score: s.totalScore / s.count, count: s.count }))
      .sort((a, b) => b.avg_score - a.avg_score)
    if (ranked.length === 0) return null
    const top = ranked[0]
    const variant = variants.find((v) => v.variant_id === top.variant_id)
    return variant ? { variant, avg_score: top.avg_score, run_count: top.count } : null
  })

export * as LocalJsonlAdapter from "./local-jsonl"
