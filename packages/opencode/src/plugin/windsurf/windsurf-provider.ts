import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"
import { launchProxyStream } from "./thinking-proxy"
import { loadWindsurfJwt } from "./credentials"
import { encodeGetChatMessageRequest, type GetChatMessageInput } from "./chat-request"
import { streamGetChatMessage, type ResponseEvent } from "./chat-client"

function getDevinPath(): string {
  const p = Bun.which("devin")
  if (!p) throw new Error("devin CLI not found — run `devin /login` first")
  return p
}

const ZERO_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
}

const STOP_REASON = { unified: "stop" as const, raw: "stop" }
const TOOL_CALLS_REASON = { unified: "tool-calls" as const, raw: "tool_use" }
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

// ── Level-2: direct Connect-RPC to Windsurf API ─────────────────────────────

function extractSystemPrompt(options: LanguageModelV3CallOptions): string {
  for (const msg of options.prompt) {
    if (msg.role === "system") return msg.content as string
  }
  return ""
}

function convertToProtoMessages(
  options: LanguageModelV3CallOptions,
): Array<{ role: number; content: string }> {
  const result: Array<{ role: number; content: string }> = []
  for (const msg of options.prompt) {
    if (msg.role === "system") continue // handled separately as system_prompt f2
    const content = msg.content
    if (typeof content === "string") {
      result.push({ role: 1, content })
      continue
    }
    // content is an array of parts
    const text = content
      .map((p) => {
        if (p.type === "text") return (p as { text: string }).text
        if (p.type === "tool-result") {
          const tr = p as unknown as { toolCallId: string; toolName: string; output: unknown }
          return `[tool result id=${tr.toolCallId} name=${tr.toolName}: ${JSON.stringify(tr.output)}]`
        }
        return ""
      })
      .join("")
    result.push({ role: 1, content: text })
  }
  return result
}

function convertTools(options: LanguageModelV3CallOptions): GetChatMessageInput["tools"] {
  const tools = options.tools
  if (!tools) return []
  return tools
    .filter((t) => t.type === "function")
    .map((t) => {
      const ft = t as import("@ai-sdk/provider").LanguageModelV3FunctionTool
      return {
        name: ft.name,
        description: ft.description ?? ft.name,
        parametersJsonSchema: JSON.stringify(ft.inputSchema),
      }
    })
}

async function streamViaDirectConnect(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  options: LanguageModelV3CallOptions,
  modelId: string,
): Promise<boolean> {
  const jwt = await loadWindsurfJwt()
  if (!jwt) return false

  const systemPrompt = extractSystemPrompt(options)
  const messages = convertToProtoMessages(options)
  const tools = convertTools(options)

  const body = encodeGetChatMessageRequest({
    jwt,
    systemPrompt,
    messages,
    tools,
    modelId,
  })

  let reasoningStarted = false
  let textStarted = false
  let finished = false

  const toolCalls = new Map<string, { name: string; argsChunks: string[] }>()
  let toolCallStarted = false

  const events = streamGetChatMessage(body)

  function flushToolCall(id: string) {
    const tc = toolCalls.get(id)
    if (!tc) return
    toolCalls.delete(id)
    const input = tc.argsChunks.join("")
    controller.enqueue({ type: "tool-input-end", id })
    controller.enqueue({ type: "tool-call", toolCallId: id, toolName: tc.name, input })
  }

  function flushAllToolCalls() {
    for (const id of toolCalls.keys()) {
      flushToolCall(id)
    }
    toolCallStarted = false
  }

  try {
    for await (const event of events) {
      if (finished) break

      switch (event.type) {
        case "reasoning": {
          if (!reasoningStarted) {
            controller.enqueue({ type: "reasoning-start", id: "0" })
            reasoningStarted = true
          }
          controller.enqueue({ type: "reasoning-delta", id: "0", delta: event.delta })
          break
        }
        case "text": {
          if (reasoningStarted) {
            controller.enqueue({ type: "reasoning-end", id: "0" })
            reasoningStarted = false
          }
          if (!textStarted) {
            controller.enqueue({ type: "text-start", id: "1" })
            textStarted = true
          }
          controller.enqueue({ type: "text-delta", id: "1", delta: event.delta })
          break
        }
        case "tool-call-start": {
          // close any prior text/reasoning stream
          if (reasoningStarted) {
            controller.enqueue({ type: "reasoning-end", id: "0" })
            reasoningStarted = false
          }
          if (textStarted) {
            controller.enqueue({ type: "text-end", id: "1" })
            textStarted = false
          }
          // flush any previous incomplete tool call
          flushAllToolCalls()
          // start new tool call
          toolCalls.set(event.id, { name: event.name, argsChunks: [] })
          controller.enqueue({ type: "tool-input-start", id: event.id, toolName: event.name })
          toolCallStarted = true
          break
        }
        case "tool-call-delta": {
          const tc = toolCalls.get(event.id)
          if (tc) {
            tc.argsChunks.push(event.argsChunk)
          }
          controller.enqueue({ type: "tool-input-delta", id: event.id, delta: event.argsChunk })
          break
        }
        case "finish": {
          finished = true
          if (reasoningStarted) {
            controller.enqueue({ type: "reasoning-end", id: "0" })
            reasoningStarted = false
          }
          if (textStarted) {
            controller.enqueue({ type: "text-end", id: "1" })
            textStarted = false
          }
          // flush any pending tool calls
          flushAllToolCalls()

          const isToolUse = event.stopReason === 10
          const usage: LanguageModelV3Usage = {
            inputTokens: {
              total: event.inputTokens,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: event.outputTokens,
              text: event.outputTokens,
              reasoning: undefined,
            },
          }
          controller.enqueue({
            type: "finish",
            finishReason: isToolUse ? TOOL_CALLS_REASON : STOP_REASON,
            usage,
          })
          break
        }
      }
    }
  } catch {
    return false
  }

  if (!finished) {
    if (reasoningStarted) controller.enqueue({ type: "reasoning-end", id: "0" })
    if (textStarted) controller.enqueue({ type: "text-end", id: "1" })
    flushAllToolCalls()
    controller.enqueue({ type: "finish", finishReason: STOP_REASON, usage: ZERO_USAGE })
  }

  controller.close()
  return true
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

// ── Proxy streaming path (best-effort reasoning enrichment) ─────────────────

async function streamViaProxy(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  events: AsyncGenerator<{ type: string; text: string } | { type: "finish"; model?: string; input_tokens?: number; output_tokens?: number; msg_id?: string }>,
): Promise<boolean> {
  let reasoningStarted = false
  let textStarted = false
  let finished = false

  try {
    for await (const event of events) {
      if (finished) break

      switch (event.type) {
        case "reasoning": {
          const t = (event as { text: string }).text
          if (!reasoningStarted) {
            controller.enqueue({ type: "reasoning-start", id: "0" })
            reasoningStarted = true
          }
          controller.enqueue({ type: "reasoning-delta", id: "0", delta: t })
          break
        }
        case "text": {
          const t = (event as { text: string }).text
          if (reasoningStarted) {
            controller.enqueue({ type: "reasoning-end", id: "0" })
            reasoningStarted = false
          }
          if (!textStarted) {
            controller.enqueue({ type: "text-start", id: "1" })
            textStarted = true
          }
          controller.enqueue({ type: "text-delta", id: "1", delta: t })
          break
        }
        case "finish": {
          finished = true
          const f = event as { model?: string; input_tokens?: number; output_tokens?: number; msg_id?: string }

          if (reasoningStarted) {
            controller.enqueue({ type: "reasoning-end", id: "0" })
            reasoningStarted = false
          }
          if (textStarted) {
            controller.enqueue({ type: "text-end", id: "1" })
            textStarted = false
          }

          const usage: LanguageModelV3Usage = {
            inputTokens: {
              total: f.input_tokens,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: f.output_tokens,
              text: f.output_tokens,
              reasoning: undefined,
            },
          }
          controller.enqueue({ type: "finish", finishReason: STOP_REASON, usage })
          break
        }
      }
    }
  } catch {
    return false
  }

  // If we never got a finish event, emit one with zero usage
  if (!finished) {
    if (reasoningStarted) controller.enqueue({ type: "reasoning-end", id: "0" })
    if (textStarted) controller.enqueue({ type: "text-end", id: "1" })
    controller.enqueue({ type: "finish", finishReason: STOP_REASON, usage: ZERO_USAGE })
  }

  controller.close()
  return true
}

// ── Fallback: direct devin -p word-split (no reasoning) ─────────────────────

async function streamViaFallback(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  modelId: string,
  text: string,
): Promise<void> {
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
    return doGenerateViaFallback(options, this.modelId)
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const text = flattenHistory(options)
    const modelId = this.modelId

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })

        // Level-2: direct Connect-RPC to Windsurf API (with tools)
        const directSuccess = await streamViaDirectConnect(controller, options, modelId)
        if (directSuccess) return

        // Try proxy path first (best-effort reasoning enrichment)
        const proxyStream = await launchProxyStream(modelId, text)
        if (proxyStream.ok) {
          const success = await streamViaProxy(controller, proxyStream.events)
          await proxyStream.cleanup()
          if (success) return
        }

        // Fallback: direct devin -p word-split (no reasoning)
        await streamViaFallback(controller, modelId, text)
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
