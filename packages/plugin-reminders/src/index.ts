import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import { Schema } from "effect"
import { Config, isValidTrigger, type Mode, type Rule } from "./config.ts"
import { readCached } from "./file-cache.ts"
import { drain, enqueue, formatInjection } from "./pending-injection.ts"
import {
  COMPACTION_TRIGGER,
  dispatchAfterTrigger,
  dispatchBeforeTrigger,
  everyTurnTrigger,
  matchingRules,
  toolAfterTrigger,
  toolBeforeTrigger,
} from "./rule-matcher.ts"

// Plugin entrypoint.
//
// Wires four hooks to deliver file-based reminders on opencode
// lifecycle events. Append-only contract: never replaces the system
// prompt (the sole exception is opt-in `mode: "replace"` for
// before:compaction, which overrides the compaction agent's prompt).
//
// `every:turn:<agent>` rules need the current agent name; the
// experimental.chat.system.transform hook does not expose it, so a
// sessionID→agent side-channel is populated by chat.message and read
// here. The mapping lags by one turn on a brand-new session but is
// accurate from turn 2 onward.
//
// `rule.file` and the loaded file contents both support template
// tokens `{sessionID}` and `{agent}`, which expand against the
// current hook context. Rules that reference a token whose value is
// not yet known (e.g. `{agent}` before the first chat.message has
// fired) are silently skipped for that invocation.
export const ReminderPlugin: Plugin = async (ctx, options) => {
  const config = parseConfig(options)
  if (!config.enabled || config.rules.length === 0) return {}

  const rules = config.rules
  const baseDir = ctx.directory
  const maxBytes = config.maxFileBytes
  const warnedPaths = new Set<string>()
  const sessionAgent = new Map<string, string>()

  return {
    "chat.message": async (input) => {
      if (input.sessionID && input.agent) sessionAgent.set(input.sessionID, input.agent)
    },

    "tool.execute.before": async (input, output) => {
      const trigger = canonicalBeforeTrigger(input.tool, output.args)
      const agentName = sessionAgent.get(input.sessionID)
      const matches = matchingRules(rules, {
        trigger,
        agentName,
        sessionID: input.sessionID,
      })
      for (const r of matches) {
        const mode = (r.mode ?? "reminder") as Mode
        if (mode === "tool-result-prefix" || mode === "replace") continue
        const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: agentName,
        })
        if (text === undefined) continue
        enqueue(input.sessionID, { text, mode, source: r.file })
      }
    },

    "tool.execute.after": async (input, output) => {
      const trigger = canonicalAfterTrigger(input.tool, input.args)
      const agentName = sessionAgent.get(input.sessionID)
      const matches = matchingRules(rules, {
        trigger,
        agentName,
        sessionID: input.sessionID,
      })
      for (const r of matches) {
        const mode = (r.mode ?? "reminder") as Mode
        const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: agentName,
        })
        if (text === undefined) continue
        if (mode === "tool-result-prefix") {
          output.output = `${text}\n\n${output.output}`
          continue
        }
        if (mode === "replace") continue
        enqueue(input.sessionID, { text, mode, source: r.file })
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID
      const agentName = sessionID ? sessionAgent.get(sessionID) : undefined

      // every:turn:<agent> rules are evaluated fresh each turn — they
      // are not queued — and only fire when an active agent is known.
      if (agentName) {
        const turnMatches = matchingRules(rules, {
          trigger: everyTurnTrigger(agentName),
          agentName,
          sessionID,
        })
        for (const r of turnMatches) {
          const mode = (r.mode ?? "reminder") as Mode
          if (mode === "tool-result-prefix" || mode === "replace") continue
          const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
            sessionID,
            agent: agentName,
          })
          if (text === undefined) continue
          output.system.push(formatInjection({ text, mode, source: r.file }))
        }
      }

      // Queued injections (from tool.execute.* hooks earlier in the turn).
      if (!sessionID) return
      const pending = drain(sessionID)
      for (const p of pending) output.system.push(formatInjection(p))
    },

    "experimental.session.compacting": async (input, output) => {
      const agentName = sessionAgent.get(input.sessionID)
      const matches = matchingRules(rules, {
        trigger: COMPACTION_TRIGGER,
        sessionID: input.sessionID,
        agentName,
      })
      if (matches.length === 0) return

      // First valid `mode: "replace"` wins; falls back to existing
      // output.prompt if the file is unreadable.
      const replaceRule = matches.find((r) => r.mode === "replace")
      if (replaceRule) {
        const text = await readFileForRule(replaceRule, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: agentName,
        })
        if (text !== undefined) output.prompt = text
      }

      for (const r of matches) {
        if (r.mode === "replace") continue
        const mode = (r.mode ?? "reminder") as Mode
        if (mode === "tool-result-prefix") continue
        const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: agentName,
        })
        if (text === undefined) continue
        output.context.push(formatInjection({ text, mode, source: r.file }))
      }
    },
  }
}

export default ReminderPlugin

type ResolvedConfig = {
  enabled: boolean
  rules: readonly Rule[]
  maxFileBytes?: number
}

type TemplateCtx = {
  sessionID?: string
  agent?: string
}

function parseConfig(options: unknown): ResolvedConfig {
  if (!options || typeof options !== "object") return { enabled: false, rules: [] }
  const decoded = Schema.decodeUnknownSync(Config)(options)
  const raw = decoded.rules ?? []
  const rules = raw.filter((r) => {
    if (isValidTrigger(r.trigger)) return true
    console.warn(`[plugin-reminders] skipping rule with invalid trigger: ${r.trigger}`)
    return false
  })
  return {
    enabled: decoded.enabled ?? false,
    rules,
    maxFileBytes: decoded.maxFileBytes,
  }
}

function canonicalBeforeTrigger(tool: string, args: unknown): string {
  const subagent = extractSubagentType(tool, args)
  if (subagent) return dispatchBeforeTrigger(subagent)
  return toolBeforeTrigger(tool)
}

function canonicalAfterTrigger(tool: string, args: unknown): string {
  const subagent = extractSubagentType(tool, args)
  if (subagent) return dispatchAfterTrigger(subagent)
  return toolAfterTrigger(tool)
}

export function extractSubagentType(tool: string, args: unknown): string | undefined {
  if (tool !== "task") return undefined
  if (!args || typeof args !== "object") return undefined
  const v = (args as Record<string, unknown>).subagent_type
  return typeof v === "string" ? v : undefined
}

async function readFileForRule(
  rule: Rule,
  baseDir: string,
  maxBytes: number | undefined,
  warned: Set<string>,
  ctx: TemplateCtx,
): Promise<string | undefined> {
  const filePath = applyTemplate(rule.file, ctx)
  if (filePath === undefined) return undefined
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath)
  const result = await readCached(abs, maxBytes)
  if (!result) {
    if (!warned.has(abs)) {
      warned.add(abs)
      console.warn(`[plugin-reminders] file not readable: ${abs} (rule trigger: ${rule.trigger})`)
    }
    return undefined
  }
  const templated = applyTemplate(result.text, ctx)
  if (templated === undefined) return undefined
  return applyTailBytes(templated, rule.tail_bytes, filePath)
}

// Returns text unchanged when tail_bytes is undefined, 0, or text fits.
// Otherwise returns the last `tail_bytes` bytes prefixed with a header
// that names the file the tail was taken from.
export function applyTailBytes(text: string, tail_bytes: number | undefined, filePath: string): string {
  if (!tail_bytes || text.length <= tail_bytes) return text
  return `... [reminders: showing last ${tail_bytes} bytes of ${filePath}]\n\n${text.slice(-tail_bytes)}`
}

// Substitutes `{sessionID}` and `{agent}` in the given text. If a
// token appears but its value in ctx is undefined, returns undefined
// to signal that the rule should be skipped this invocation rather
// than emit a half-resolved string.
export function applyTemplate(text: string, ctx: TemplateCtx): string | undefined {
  if (text.includes("{sessionID}") && !ctx.sessionID) return undefined
  if (text.includes("{agent}") && !ctx.agent) return undefined
  return text.replaceAll("{sessionID}", ctx.sessionID ?? "").replaceAll("{agent}", ctx.agent ?? "")
}
