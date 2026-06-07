import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { InstanceState } from "@/effect/instance-state"
import { SessionSummarySchema } from "@/agent/aki-main/session-summary-schema"
import YAML from "yaml"
import DESCRIPTION from "./session-summary-emit.txt"

export const Parameters = SessionSummarySchema.SessionSummary

type Metadata = {
  path: string
  summary: string
}

const DENYLIST_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(openai|openrouter|anthropic|cohere|deepseek)-[A-Za-z0-9_-]{20,}/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
]

const STRICT_LINE_PATTERN =
  /\b(key|secret|token|password|passwd|api[_-]?key|auth|bearer|credential)[\s]*[:=][\s]*\S+/gi

const redactDenylist = (input: string): string =>
  DENYLIST_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), input)

const redactStrict = (input: string): string =>
  redactDenylist(input).replace(STRICT_LINE_PATTERN, (m) =>
    m.replace(/[:=][\s]*\S+/, (suffix) => suffix.replace(/\S+$/, "[REDACTED]")),
  )

const applyRedaction = (
  summary: Schema.Schema.Type<typeof Parameters>,
): Schema.Schema.Type<typeof Parameters> => {
  if (summary.redaction_policy === "none") return summary
  const fn = summary.redaction_policy === "strict" ? redactStrict : redactDenylist
  return {
    ...summary,
    turn_arc: summary.turn_arc.map((t) => ({
      ...t,
      prompt_summary: fn(t.prompt_summary),
      outcome_summary: fn(t.outcome_summary),
    })),
    open_threads: summary.open_threads.map(fn),
  }
}

export const SessionSummaryEmitTool = Tool.define<typeof Parameters, Metadata, never>(
  "session_summary_emit",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const dir = path.join(instance.worktree === "/" ? instance.directory : instance.worktree, ".opencode", "aki-main")
          const fileName = `session-${Date.now()}.yaml`
          const filePath = path.join(dir, fileName)
          const redacted = applyRedaction(input)

          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(dir, { recursive: true })
            await fs.writeFile(filePath, YAML.stringify(redacted), "utf-8")
          })

          return {
            title: "Session summary emitted",
            output: `Session summary written to ${filePath}. turns=${redacted.aggregate_stats.turns} specialists=${redacted.aggregate_stats.specialists_invoked_count} elapsed=${redacted.aggregate_stats.time_elapsed_seconds}s redaction=${redacted.redaction_policy}`,
            metadata: {
              path: filePath,
              summary: `turns=${redacted.aggregate_stats.turns} specialists=${redacted.aggregate_stats.specialists_invoked_count} redaction=${redacted.redaction_policy}`,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
