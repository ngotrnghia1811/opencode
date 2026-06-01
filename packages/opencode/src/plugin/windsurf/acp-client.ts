import { spawn, type Subprocess } from "bun"

// ── JSON-RPC 2.0 wire types ──────────────────────────────────────────────────

type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

// ── ACP event types ──────────────────────────────────────────────────────────

export type AcpEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "finish"; reason: string }
  | { type: "error"; message: string }

// ── ACP session ──────────────────────────────────────────────────────────────

export interface AcpSession {
  proc: Subprocess
  stdin: { write: (data: string) => number; flush: () => void; end: () => void }
  nextId: number
  reader: ReadableStreamDefaultReader<Uint8Array>
  decoder: TextDecoder
  buffer: string
  disposed: boolean
}

// ── Session lifecycle ────────────────────────────────────────────────────────

export async function startAcpSession(modelId: string): Promise<AcpSession> {
  const devinPath = Bun.which("devin")
  if (!devinPath) throw new Error("devin CLI not found — run `devin /login` first")

  const proc = spawn({
    cmd: [devinPath, "acp"],
    env: { ...process.env, DEVIN_MODEL: modelId },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  const stdin = proc.stdin as unknown as AcpSession["stdin"]

  const session: AcpSession = {
    proc,
    stdin,
    nextId: 2,
    reader,
    decoder,
    buffer: "",
    disposed: false,
  }

  const initReq = buildRequest(1, "initialize", {
    protocolVersion: "1.0",
    clientInfo: { name: "opencode-windsurf-bridge", version: "1.0.0" },
    capabilities: {},
  })
  stdin.write(JSON.stringify(initReq) + "\n")
  await stdin.flush()

  const initMsg = await readLine(session)
  if (!initMsg) throw new Error("ACP initialize: no response from devin acp")
  const parsed = parseJsonSafe(initMsg) as JsonRpcResponse | null
  if (!parsed || parsed.error) {
    const errMsg = parsed?.error?.message ?? "invalid initialize response"
    throw new Error(`ACP initialize failed: ${errMsg}`)
  }

  return session
}

// ── Building messages ────────────────────────────────────────────────────────

function buildRequest(id: number, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params }
}

function buildNotification(method: string, params?: unknown): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params }
}

// ── Sending messages ─────────────────────────────────────────────────────────

export async function sendUserMessage(session: AcpSession, text: string): Promise<void> {
  if (session.disposed) return
  const msg = buildNotification("userMessage", { text })
  session.stdin.write(JSON.stringify(msg) + "\n")
  await session.stdin.flush()
}

export async function sendToolResult(
  session: AcpSession,
  toolCallId: string,
  result: string,
): Promise<void> {
  if (session.disposed) return
  const msg = buildNotification("toolResult", { toolCallId, result })
  session.stdin.write(JSON.stringify(msg) + "\n")
  await session.stdin.flush()
}

// ── Event processing ─────────────────────────────────────────────────────────

export async function nextAcpEvent(session: AcpSession): Promise<AcpEvent | null> {
  while (true) {
    const line = await readLine(session)
    if (!line) return null

    const msg = parseJsonSafe(line) as Record<string, unknown> | null
    if (!msg) continue

    const method = msg.method as string | undefined
    if (!method) continue

    const params = (msg.params as Record<string, unknown>) ?? {}

    if (method === "text_delta") {
      return { type: "text_delta", text: (params.text as string) ?? (params.delta as string) ?? "" }
    }

    if (method === "tool_call") {
      return {
        type: "tool_call",
        id: (params.toolCallId as string) ?? (params.id as string) ?? "",
        name: (params.toolName as string) ?? (params.name as string) ?? "unknown",
        input: (params.input as Record<string, unknown>) ?? {},
      }
    }

    if (method === "complete" || method === "finish") {
      return { type: "finish", reason: (params.reason as string) ?? "stop" }
    }

    if (method === "error") {
      return { type: "error", message: (params.message as string) ?? "Unknown ACP error" }
    }
  }
}

// ── Line reading from the shared buffer ──────────────────────────────────────

async function readLine(session: AcpSession): Promise<string | null> {
  while (true) {
    const newlineIdx = session.buffer.indexOf("\n")
    if (newlineIdx >= 0) {
      const line = session.buffer.slice(0, newlineIdx)
      session.buffer = session.buffer.slice(newlineIdx + 1)
      return line
    }

    const { done, value } = await session.reader.read()
    if (done) return null
    session.buffer += session.decoder.decode(value, { stream: true })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export function closeAcpSession(session: AcpSession): void {
  if (session.disposed) return
  session.disposed = true
  session.stdin.end()
  session.proc.kill()
}
