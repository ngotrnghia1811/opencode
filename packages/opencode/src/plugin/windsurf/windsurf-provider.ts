import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import {
  startAcpSession,
  sendUserMessage,
  nextAcpEvent,
  closeAcpSession,
} from "./acp-client"

function getDevinPath(): string {
  const p = Bun.which("devin")
  if (!p) throw new Error("devin CLI not found — run `devin /login` first")
  return p
}

const ZERO_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const

const STOP_REASON = { unified: "stop" as const, raw: "stop" }
const ERROR_REASON = { unified: "error" as const, raw: "error" }

function stripDevinBanner(text: string): string {
  const noAnsi = text.replace(/\x1b\[[0-9;]*m/g, "")
  const bannerPatterns = [
    "Welcome to Devin CLI",
    "Logged in as",
    "You're all set",
    "✓ Organization",
  ]
  const lines = noAnsi.split("\n")
  let start = 0
  for (let i = 0; i < lines.length; i++) {
    if (bannerPatterns.some((p) => lines[i].includes(p))) {
      start = i + 1
      continue
    }
    break
  }
  return lines.slice(start).join("\n")
}

function flattenPrompt(text: string): string {
  // Thin wrapper kept for the fallback path
  return text
}

function flattenHistory(options: LanguageModelV3CallOptions): string {
  const tools = (options as { tools?: Record<string, { description?: string; parameters?: unknown }> }).tools
  const toolsPrompt = tools
    ? `<tools>\n${Object.entries(tools)
        .map(([name, def]) => `  ${name}: ${def.description ?? name}`)
        .join("\n")}\n</tools>\n\n`
    : ""

  const messages = options.prompt
    .map((msg) => {
      const role = msg.role
      const parts = typeof msg.content === "string" ? msg.content : msg.content
      if (typeof parts === "string") return `${role}: ${parts}`
      return `${role}: ${parts
        .map((p) => {
          if (p.type === "text") return (p as { type: "text"; text: string }).text
          if (p.type === "tool-result") {
            const tr = p as unknown as { toolCallId: string; toolName: string; output: unknown }
            return `[tool result #${tr.toolCallId}: ${JSON.stringify(tr.output)}]`
          }
          return ""
        })
        .join("")}`
    })
    .join("\n\n")

  return toolsPrompt + messages
}

// ── Fallback: devin -p path ──────────────────────────────────────────────────

async function fallbackDevinRun(
  modelId: string,
  prompt: string,
): Promise<{ output: string; exitCode: number; stderr: string }> {
  const proc = Bun.spawn(
    [getDevinPath(), "--permission-mode", "bypass", "--model", modelId, "-p", "--", prompt],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const output = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { output, exitCode, stderr }
}

async function doGenerateViaAcp(options: LanguageModelV3CallOptions, modelId: string): Promise<LanguageModelV3GenerateResult> {
  const text = flattenHistory(options)
  const session = await startAcpSession(modelId)

  await sendUserMessage(session, text)

  const buffer: string[] = []
  let acpError: string | null = null
  let finishReason: { unified: "stop" | "error"; raw: string } = STOP_REASON

  while (true) {
    const event = await nextAcpEvent(session)
    if (!event) {
      finishReason = ERROR_REASON
      acpError = acpError ?? "ACP session closed unexpectedly"
      break
    }

    if (event.type === "text_delta") {
      buffer.push(event.text)
      continue
    }

    if (event.type === "tool_call") {
      buffer.push(`\n[Tool call: ${event.name}(${JSON.stringify(event.input)})]`)
      continue
    }

    if (event.type === "finish") {
      break
    }

    if (event.type === "error") {
      finishReason = ERROR_REASON
      acpError = event.message
      break
    }
  }

  closeAcpSession(session)

  if (finishReason.unified === "error") {
    throw new Error(acpError ?? "ACP error")
  }

  return {
    content: [{ type: "text", text: stripDevinBanner(buffer.join("")) }],
    finishReason,
    usage: ZERO_USAGE,
    warnings: [],
  }
}

async function doGenerateViaFallback(options: LanguageModelV3CallOptions, modelId: string): Promise<LanguageModelV3GenerateResult> {
  const prompt = flattenHistory(options)
  const { output, exitCode, stderr } = await fallbackDevinRun(modelId, prompt)

  if (exitCode !== 0) {
    throw new Error(`devin exited with code ${exitCode}: ${stderr.slice(0, 500)}`)
  }

  return {
    content: [{ type: "text", text: stripDevinBanner(output) }],
    finishReason: STOP_REASON,
    usage: ZERO_USAGE,
    warnings: [],
  }
}

// ── Model class ──────────────────────────────────────────────────────────────

export class WindsurfLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  constructor(modelId: string) {
    this.provider = "windsurf"
    this.modelId = modelId
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    return doGenerateViaAcp(options, this.modelId).catch(() =>
      doGenerateViaFallback(options, this.modelId),
    )
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const text = flattenHistory(options)
    const modelId = this.modelId

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })

        let started = false

        const useAcp = async () => {
          const session = await startAcpSession(modelId)
          await sendUserMessage(session, text)

          while (true) {
            const event = await nextAcpEvent(session)
            if (!event) {
              if (started) controller.enqueue({ type: "text-end", id: "0" })
              controller.enqueue({ type: "finish", finishReason: ERROR_REASON, usage: ZERO_USAGE })
              controller.close()
              closeAcpSession(session)
              return
            }

            if (event.type === "text_delta") {
              if (!started) {
                started = true
                controller.enqueue({ type: "text-start", id: "0" })
              }
              controller.enqueue({ type: "text-delta", id: "0", delta: event.text })
              continue
            }

            if (event.type === "tool_call") {
              if (!started) {
                started = true
                controller.enqueue({ type: "text-start", id: "0" })
              }
              const inputStr = JSON.stringify(event.input)
              controller.enqueue({
                type: "tool-input-start",
                id: event.id,
                toolName: event.name,
              } satisfies LanguageModelV3StreamPart)
              controller.enqueue({
                type: "tool-input-delta",
                id: event.id,
                delta: inputStr,
              } satisfies LanguageModelV3StreamPart)
              controller.enqueue({
                type: "tool-input-end",
                id: event.id,
              } satisfies LanguageModelV3StreamPart)
              controller.enqueue({
                type: "tool-call",
                toolCallId: event.id,
                toolName: event.name,
                input: inputStr,
              } satisfies LanguageModelV3StreamPart)
              continue
            }

            if (event.type === "finish") {
              if (started) controller.enqueue({ type: "text-end", id: "0" })
              controller.enqueue({ type: "finish", finishReason: STOP_REASON, usage: ZERO_USAGE })
              controller.close()
              closeAcpSession(session)
              return
            }

            if (event.type === "error") {
              controller.enqueue({ type: "error", error: new Error(event.message) })
              controller.enqueue({ type: "finish", finishReason: ERROR_REASON, usage: ZERO_USAGE })
              controller.close()
              closeAcpSession(session)
              return
            }
          }
        }

        const fallback = async () => {
          const proc = Bun.spawn(
            [getDevinPath(), "--permission-mode", "bypass", "--model", modelId, "-p", "--", text],
            {
              stdout: "pipe",
              stderr: "pipe",
            },
          )

          const output = await new Response(proc.stdout).text()
          const stripped = stripDevinBanner(output)
          const wordPattern = /\S+\s*/g
          const words = stripped.match(wordPattern) ?? []

          controller.enqueue({ type: "text-start", id: "0" })
          for (const word of words) {
            controller.enqueue({ type: "text-delta", id: "0", delta: word })
          }

          const exitCode = await proc.exited
          if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text()
            controller.enqueue({ type: "error", error: new Error(`devin exit ${exitCode}: ${stderr.slice(0, 200)}`) })
            controller.enqueue({ type: "finish", finishReason: ERROR_REASON, usage: ZERO_USAGE })
            controller.close()
            return
          }
          controller.enqueue({ type: "text-end", id: "0" })
          controller.enqueue({ type: "finish", finishReason: STOP_REASON, usage: ZERO_USAGE })
          controller.close()
        }

        useAcp().catch(() => {
          // Wipe partial stream and fallback
          started = false
          return fallback()
        })
      },
    })

    return { stream }
  }
}

export function createWindsurf(opts: { name: string }) {
  return {
    languageModel(modelId: string): LanguageModelV3 {
      return new WindsurfLanguageModel(modelId)
    },
  }
}

export * as WindsurfProvider from "."
