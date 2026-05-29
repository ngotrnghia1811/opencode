import type { Mode } from "./config.ts"

export type Pending = {
  text: string
  mode: Mode
  source: string
}

const queues = new Map<string, Pending[]>()

export function enqueue(sessionID: string, pending: Pending): void {
  const existing = queues.get(sessionID)
  if (existing) {
    existing.push(pending)
    return
  }
  queues.set(sessionID, [pending])
}

export function drain(sessionID: string): Pending[] {
  const out = queues.get(sessionID)
  if (!out) return []
  queues.delete(sessionID)
  return out
}

export function peek(sessionID: string): readonly Pending[] {
  return queues.get(sessionID) ?? []
}

export function clearAll(): void {
  queues.clear()
}

// Wraps file content for emission into the system prompt according to
// the rule's mode. `replace` and `tool-result-prefix` are not emitted
// through the system-prompt path (they are handled at their own
// injection points) so this function asserts on them.
export function formatInjection(p: Pending): string {
  if (p.mode === "reminder") {
    return `<system-reminder source="${p.source}">\n${p.text}\n</system-reminder>`
  }
  if (p.mode === "append") return p.text
  throw new Error(`formatInjection: mode "${p.mode}" is not emitted through the system-prompt path`)
}
