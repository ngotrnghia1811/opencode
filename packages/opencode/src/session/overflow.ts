import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const output = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
  const reserved = input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, output)
  if (input.model.limit.input) return Math.max(0, input.model.limit.input - reserved)
  // Some catalogs report an output cap equal to the whole context window (for
  // example xai grok-4.7: context 500K, output 500K). Reserving the full output
  // would leave no usable input, so fall back to the input-limit reserve.
  if (output >= context) return Math.max(0, context - reserved)
  return context - output
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  // A non-positive budget would make every turn overflow and compact forever.
  const limit = usable(input)
  if (limit <= 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= limit
}
