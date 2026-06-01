import { spawn, type Subprocess } from "bun"

// ── JSON-RPC 2.0 wire types ──────────────────────────────────────────

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

// ── ACP event types ──────────────────────────────────────────────────

export type AcpEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; status: string }
  | { type: "tool_call_update"; id: string; status: string; content?: unknown }
  | { type: "end_turn"; stopReason: string }

// ── ACP session ──────────────────────────────────────────────────────

export interface AcpSession {
  proc: Subprocess
  stdin: { write: (data: string) => number; flush: () => void; end: () => void }
  sessionId: string
  nextId: number
  reader: ReadableStreamDefaultReader<Uint8Array>
  decoder: TextDecoder
  buffer: string
  disposed: boolean
}

// ── Session lifecycle ────────────────────────────────────────────────

export async function startAcpSession(modelId: string, cwd?: string): Promise<AcpSession> {
  const devinPath = Bun.which("devin")
  if (!devinPath) throw new Error("devin CLI not found — run `devin /login` first")

  const proc = spawn({
    cmd: [devinPath, "acp"],
    env: { ...Bun.env, DEVIN_MODEL: modelId },
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
    sessionId: "",
    nextId: 3,
    reader,
    decoder,
    buffer: "",
    disposed: false,
  }

  // 1. Initialize
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

  // 2. Session/new
  const sessionReq = buildRequest(2, "session/new", { cwd: cwd ?? process.cwd(), mcpServers: [] })
  stdin.write(JSON.stringify(sessionReq) + "\n")
  await stdin.flush()

  const sessionMsg = await readLine(session)
  if (!sessionMsg) throw new Error("ACP session/new: no response from devin acp")
  const sessionParsed = parseJsonSafe(sessionMsg) as Record<string, unknown> | null
  if (!sessionParsed || sessionParsed.error) {
    const errMsg = (sessionParsed?.error as { message?: string })?.message ?? "invalid session/new response"
    throw new Error(`ACP session/new failed: ${errMsg}`)
  }
  const result = sessionParsed.result as Record<string, unknown> | undefined
  session.sessionId = (result?.sessionId as string) ?? ""

  return session
}

// ── Building messages ────────────────────────────────────────────────

function buildRequest(id: number, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params }
}

// ── Sending messages ─────────────────────────────────────────────────

export async function sendPrompt(session: AcpSession, text: string): Promise<number> {
  const id = session.nextId++
  if (session.disposed) return id
  const msg = buildRequest(id, "session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text }],
  })
  session.stdin.write(JSON.stringify(msg) + "\n")
  await session.stdin.flush()
  return id
}

// ── Event processing ─────────────────────────────────────────────────

export async function nextAcpEvent(session: AcpSession, promptId: number): Promise<AcpEvent | null> {
  while (!session.disposed) {
    const line = await readLine(session)
    if (!line) return null

    const msg = parseJsonSafe(line) as Record<string, unknown> | null
    if (!msg) continue

    // Has id → response (not a notification)
    if ("id" in msg) {
      if (msg.id !== promptId) continue
      const result = msg.result as Record<string, unknown> | undefined
      if (result?.stopReason !== undefined) {
        return { type: "end_turn", stopReason: result.stopReason as string }
      }
      if (msg.error) return { type: "end_turn", stopReason: "error" }
      continue
    }

    // No id → session/update notification
    const method = msg.method as string | undefined
    if (method !== "session/update") continue

    const params = msg.params as Record<string, unknown> | undefined
    if (!params) continue

    const update = params.update as Record<string, unknown> | undefined
    if (!update) continue

    const sessionUpdate = update.sessionUpdate as string | undefined

    if (sessionUpdate === "agent_message_chunk") {
      const content = update.content as { type: string; text: string } | undefined
      return { type: "text_delta", text: content?.text ?? "" }
    }

    if (sessionUpdate === "tool_call") {
      return {
        type: "tool_call",
        id: (update.toolCallId as string) ?? "",
        name: (update.title as string) ?? "",
        status: (update.status as string) ?? "pending",
      }
    }

    if (sessionUpdate === "tool_call_update") {
      return {
        type: "tool_call_update",
        id: (update.toolCallId as string) ?? "",
        status: (update.status as string) ?? "unknown",
        content: update.content,
      }
    }
  }
  return null
}

// ── Line reading from the shared buffer ──────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────

export function closeAcpSession(session: AcpSession): void {
  if (session.disposed) return
  session.disposed = true
  session.stdin.end()
  session.proc.kill()
}
