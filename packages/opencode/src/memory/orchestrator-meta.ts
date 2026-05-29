import { LocalJsonlAdapter } from "./adapters/local-jsonl"
import { McpGraphitiAdapter } from "./adapters/mcp-graphiti"
import { OrchestratorMetaSchema } from "./orchestrator-meta-schema"

const backend = () =>
  process.env["AKI_META_BACKEND"] === "mcp-graphiti" ? McpGraphitiAdapter : LocalJsonlAdapter

export const recordVariant = (variant: OrchestratorMetaSchema.VariantEntity) =>
  backend().recordVariant(variant)

export const recordRun = (run: OrchestratorMetaSchema.RunOutcome) =>
  backend().recordRun(run)

export const findSimilarVariants = (taskShape: string, topK?: number) =>
  backend().findSimilarVariants(taskShape, topK)

export const bestVariantFor = (taskClass: string) =>
  backend().bestVariantFor(taskClass)

export * as OrchestratorMeta from "./orchestrator-meta"
