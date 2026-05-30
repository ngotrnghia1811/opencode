import type { Rule, Scope } from "./config.ts"

export type MatchInput = {
  trigger: string
  agentName?: string
  sessionID?: string
  modelID?: string
}

export function matchingRules(rules: readonly Rule[], input: MatchInput): Rule[] {
  return rules.filter((r) => triggerMatches(r.trigger, input.trigger) && scopeMatches(r.scope, input))
}

// Trigger matching.
//
// A configured trigger may carry a `*` wildcard in its trailing segment
// (the tool id, dispatch agent name, or every-turn agent name). The
// `input.trigger` is always the canonical, fully-resolved form emitted
// by the plugin entrypoint, e.g. "before:tool:question" or
// "before:dispatch:aki-execute".
export function triggerMatches(configured: string, actual: string): boolean {
  if (configured === actual) return true
  const cParts = configured.split(":")
  const aParts = actual.split(":")
  if (cParts.length !== aParts.length) return false
  return cParts.every((seg, i) => seg === "*" || seg === aParts[i])
}

export function scopeMatches(scope: Scope | undefined, input: MatchInput): boolean {
  if (!scope) return true
  if (scope.agent !== undefined && !globMatch(scope.agent, input.agentName)) return false
  if (scope.session !== undefined && !globMatch(scope.session, input.sessionID)) return false
  if (scope.model !== undefined && !globMatch(scope.model, input.modelID)) return false
  return true
}

// Tiny glob: supports `*` (any run of chars) and literal text. No `?`,
// no character classes. Sufficient for matching ids like "aki-*" or
// "*claude*". A `value` of `undefined` matches only a literal `*`.
export function globMatch(pattern: string, value: string | undefined): boolean {
  if (value === undefined) return pattern === "*"
  if (pattern === "*") return true
  if (!pattern.includes("*")) return pattern === value
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(value)
}

// Helpers for the plugin entrypoint to build canonical trigger strings.
export function toolBeforeTrigger(toolId: string): string {
  return `before:tool:${toolId}`
}
export function toolAfterTrigger(toolId: string): string {
  return `after:tool:${toolId}`
}
export function dispatchBeforeTrigger(agent: string): string {
  return `before:dispatch:${agent}`
}
export function dispatchAfterTrigger(agent: string): string {
  return `after:dispatch:${agent}`
}
export function everyTurnTrigger(agent: string): string {
  return `every:turn:${agent}`
}
export function messageTrigger(agent: string): string {
  return `on:message:${agent}`
}
export const COMPACTION_TRIGGER = "before:compaction"
