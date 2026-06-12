import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import { Schema } from "effect"
import { Config, isValidTrigger, type Mode, type Rule } from "./config.ts"
import { readCached } from "./file-cache.ts"
import { applyTailBytes, applyTemplate, ensureFilesForRule, extractSubagentType, type TemplateCtx } from "./helpers.ts"
import { drain, enqueue, formatInjection } from "./pending-injection.ts"
import {
  COMPACTION_TRIGGER,
  dispatchAfterTrigger,
  dispatchBeforeTrigger,
  everyTurnTrigger,
  matchingRules,
  messageTrigger,
  scopeMatches,
  toolAfterTrigger,
  toolBeforeTrigger,
} from "./rule-matcher.ts"
export { appendQA, appendPlan } from "./storage.ts"
export { readQA, readPlan } from "./reader.ts"
export type { QAEntry, PlanEntry } from "./reader.ts"

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
  const sessionModel = new Map<string, string>()

  return {
    "chat.message": async (input) => {
      if (input.sessionID && input.agent) sessionAgent.set(input.sessionID, input.agent)
      if (input.sessionID && input.model?.modelID) sessionModel.set(input.sessionID, input.model.modelID)
      if (!input.sessionID || !input.agent) return
      const matches = matchingRules(rules, {
        trigger: messageTrigger(input.agent),
        agentName: input.agent,
        sessionID: input.sessionID,
        modelID: input.model?.modelID,
      })
      for (const r of matches) {
        await ensureFilesForRule(r, baseDir, { sessionID: input.sessionID, agent: input.agent, date: todayDate() })
        const mode = (r.mode ?? "reminder") as Mode
        if (mode === "tool-result-prefix" || mode === "replace") continue
        const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: input.agent,
          date: todayDate(),
        })
        if (text === undefined) continue
        enqueue(input.sessionID, { text, mode, source: r.file, label: r.label })
      }
    },

    "tool.execute.before": async (input, output) => {
      const trigger = canonicalBeforeTrigger(input.tool, output.args)
      const agentName = sessionAgent.get(input.sessionID)
      const matches = matchingRules(rules, {
        trigger,
        agentName,
        sessionID: input.sessionID,
        modelID: sessionModel.get(input.sessionID),
      })
      for (const r of matches) {
        // before:tool:* and before:dispatch:* triggers are handled
        // proactively in system.transform; skip them here so they
        // aren't enqueued (which would only surface next turn).
        if (r.trigger.startsWith("before:tool:") || r.trigger.startsWith("before:dispatch:")) continue
        await ensureFilesForRule(r, baseDir, { sessionID: input.sessionID, agent: agentName, date: todayDate() })
        const mode = (r.mode ?? "reminder") as Mode
        if (mode === "tool-result-prefix" || mode === "replace") continue
        const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: agentName,
          date: todayDate(),
        })
        if (text === undefined) continue
        enqueue(input.sessionID, { text, mode, source: r.file, label: r.label })
      }
    },

    "tool.execute.after": async (input, output) => {
      const trigger = canonicalAfterTrigger(input.tool, input.args)
      const agentName = sessionAgent.get(input.sessionID)
      const matches = matchingRules(rules, {
        trigger,
        agentName,
        sessionID: input.sessionID,
        modelID: sessionModel.get(input.sessionID),
      })
      for (const r of matches) {
        // Guard: before:* triggers shouldn't match after triggers, but
        // skip them for safety in case the grammar expands.
        if (r.trigger.startsWith("before:tool:") || r.trigger.startsWith("before:dispatch:")) continue
        await ensureFilesForRule(r, baseDir, { sessionID: input.sessionID, agent: agentName, date: todayDate() })
        const mode = (r.mode ?? "reminder") as Mode
        const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: agentName,
          date: todayDate(),
        })
        if (text === undefined) continue
        if (mode === "tool-result-prefix") {
          output.output = `${text}\n\n${output.output}`
          continue
        }
        if (mode === "replace") continue
        enqueue(input.sessionID, { text, mode, source: r.file, label: r.label })
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID
      const agentName = sessionID ? sessionAgent.get(sessionID) : undefined
      const modelID = input.model?.id ?? (sessionID ? sessionModel.get(sessionID) : undefined)
      if (sessionID && input.model?.id) sessionModel.set(sessionID, input.model.id)

      // Proactive injection: every:turn:*, before:tool:*, and
      // before:dispatch:* rules are evaluated fresh each turn — they
      // are not queued — and only fire when an active agent is known.
      // This ensures the agent sees the reminder in the system prompt
      // BEFORE making tool-call decisions (the queued path only
      // surfaces reminders on the NEXT turn, which is too late).
      if (agentName) {
        const turnMatches = matchingRules(rules, {
          trigger: everyTurnTrigger(agentName),
          agentName,
          sessionID,
          modelID,
        })
        const beforeMatches = rules.filter((r) => {
          const t = r.trigger
          if (!t.startsWith("before:tool:") && !t.startsWith("before:dispatch:")) return false
          return scopeMatches(r.scope, { trigger: "", agentName, sessionID, modelID })
        })
        const allProactive = [...turnMatches, ...beforeMatches]
        for (const r of allProactive) {
          await ensureFilesForRule(r, baseDir, { sessionID, agent: agentName, date: todayDate() })
          const mode = (r.mode ?? "reminder") as Mode
          if (mode === "tool-result-prefix" || mode === "replace") continue
          const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
            sessionID,
            agent: agentName,
            date: todayDate(),
          })
          if (text === undefined) continue
          output.system.push(formatInjection({ text, mode, source: r.file, label: r.label }))
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
        modelID: sessionModel.get(input.sessionID),
      })
      if (matches.length === 0) return

      // First valid `mode: "replace"` wins; falls back to existing
      // output.prompt if the file is unreadable.
      const replaceRule = matches.find((r) => r.mode === "replace")
      if (replaceRule) {
        const text = await readFileForRule(replaceRule, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: agentName,
          date: todayDate(),
        })
        if (text !== undefined) output.prompt = text
      }

      for (const r of matches) {
        await ensureFilesForRule(r, baseDir, { sessionID: input.sessionID, agent: agentName, date: todayDate() })
        if (r.mode === "replace") continue
        const mode = (r.mode ?? "reminder") as Mode
        if (mode === "tool-result-prefix") continue
        const text = await readFileForRule(r, baseDir, maxBytes, warnedPaths, {
          sessionID: input.sessionID,
          agent: agentName,
          date: todayDate(),
        })
        if (text === undefined) continue
        output.context.push(formatInjection({ text, mode, source: r.file, label: r.label }))
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

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
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

