export type TemplateCtx = {
  sessionID?: string
  agent?: string
}

export function extractSubagentType(tool: string, args: unknown): string | undefined {
  if (tool !== "task") return undefined
  if (!args || typeof args !== "object") return undefined
  const v = (args as Record<string, unknown>).subagent_type
  return typeof v === "string" ? v : undefined
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
