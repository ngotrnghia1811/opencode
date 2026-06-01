import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"

const DEVIN_PATH = Bun.which("devin") || (() => { throw new Error("devin CLI not found") })()

const ZERO_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const

const STOP_REASON = { unified: "stop" as const, raw: "stop" }
const ERROR_REASON = { unified: "error" as const, raw: "error" }

function flattenPrompt(options: LanguageModelV3CallOptions): string {
  const last = options.prompt[options.prompt.length - 1]
  if (!last) return ""
  const parts = last.content
  if (typeof parts === "string") return parts
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

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
    const prompt = flattenPrompt(options)
    const proc = Bun.spawn([DEVIN_PATH, "--permission-mode", "bypass", "--model", this.modelId, "-p", "--", prompt], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      throw new Error(`devin exited with code ${exitCode}: ${stderr.slice(0, 500)}`)
    }

    return {
      content: [{ type: "text", text: output }],
      finishReason: STOP_REASON,
      usage: ZERO_USAGE,
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const prompt = flattenPrompt(options)
    const modelId = this.modelId

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: "0" })

        const proc = Bun.spawn([DEVIN_PATH, "--permission-mode", "bypass", "--model", modelId, "-p", "--", prompt], {
          stdout: "pipe",
          stderr: "pipe",
        })

        const reader = proc.stdout.getReader()
        const decoder = new TextDecoder()
        const wordPattern = /\S+\s*/g

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            const words = text.match(wordPattern) ?? []
            for (const word of words) {
              controller.enqueue({ type: "text-delta", id: "0", delta: word })
            }
          }
          const remaining = decoder.decode()
          const lastWords = remaining.match(wordPattern) ?? []
          for (const word of lastWords) {
            controller.enqueue({ type: "text-delta", id: "0", delta: word })
          }
        } catch (err) {
          controller.enqueue({ type: "error", error: err })
          controller.enqueue({ type: "finish", finishReason: ERROR_REASON, usage: ZERO_USAGE })
          controller.close()
          return
        }

        const exitCode = await proc.exited
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text()
          controller.enqueue({ type: "error", error: new Error(`devin exit ${exitCode}: ${stderr.slice(0, 200)}`) })
          controller.enqueue({ type: "finish", finishReason: ERROR_REASON, usage: ZERO_USAGE })
        } else {
          controller.enqueue({ type: "text-end", id: "0" })
          controller.enqueue({ type: "finish", finishReason: STOP_REASON, usage: ZERO_USAGE })
        }
        controller.close()
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
