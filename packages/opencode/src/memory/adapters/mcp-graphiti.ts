import { Effect } from "effect"
import { OrchestratorMetaSchema } from "../orchestrator-meta-schema"

// TODO(F13 §6 Q, F14 training infra): implement Graphiti MCP backend.
// v1 ships local-jsonl only. This stub exists so the adapter switch in
// orchestrator-meta.ts has a destination when AKI_META_BACKEND=mcp-graphiti.
// Full impl needs Graphiti MCP server discovery + node/edge mapping for the
// VariantEntity / RunOutcome schemas.

const notImplemented = (fn: string) =>
  Effect.die(
    `mcp-graphiti adapter is not implemented in v1 (called: ${fn}). ` +
      `Set AKI_META_BACKEND=local-jsonl or implement F13 §6 Q's Graphiti integration.`,
  )

export const recordVariant = (_variant: OrchestratorMetaSchema.VariantEntity) =>
  notImplemented("recordVariant")

export const recordRun = (_run: OrchestratorMetaSchema.RunOutcome) =>
  notImplemented("recordRun")

export const findSimilarVariants = (_taskShape: string, _topK?: number) =>
  notImplemented("findSimilarVariants")

export const bestVariantFor = (_taskClass: string) =>
  notImplemented("bestVariantFor")

export * as McpGraphitiAdapter from "./mcp-graphiti"
