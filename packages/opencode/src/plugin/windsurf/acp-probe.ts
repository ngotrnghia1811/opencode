// acp-probe.ts — standalone probe to test whether `devin acp` surfaces thinking content.
// Usage: bun run src/plugin/windsurf/acp-probe.ts  (from packages/opencode/)
import {
  startAcpSession,
  sendPrompt,
  nextAcpEvent,
  closeAcpSession,
  type AcpEvent,
  type AcpSession,
} from "./acp-client"

const MODEL = "claude-sonnet-4-6-thinking"
const PROMPT = "What is 2+2? Answer in one sentence."

async function main() {
  console.log("=" .repeat(70))
  console.log("ACP PROBE — Testing thinking/reasoning detection")
  console.log("=" .repeat(70))
  console.log(`Model:   ${MODEL}`)
  console.log(`Prompt:  ${PROMPT}`)
  console.log(`Date:    ${new Date().toISOString()}`)
  console.log("=" .repeat(70))

  // Check devin CLI availability
  const devinPath = Bun.which("devin")
  console.log(`\n[SETUP] devin binary: ${devinPath ?? "NOT FOUND"}`)
  if (!devinPath) {
    console.log("[FATAL] devin CLI not found — run `devin /login` first")
    process.exit(1)
  }

  // Phase 1 — start ACP session
  console.log("\n[PHASE 1] Starting ACP session...")
  let session: AcpSession
  try {
    session = await startAcpSession(MODEL)
    console.log(`[PHASE 1] Session started. sessionId=${session.sessionId}`)
  } catch (err) {
    console.log(`[FATAL] Session start failed: ${err}`)
    process.exit(1)
  }

  // Phase 2 — send prompt
  console.log(`\n[PHASE 2] Sending session/prompt: "${PROMPT}"`)
  let promptId: number
  try {
    promptId = await sendPrompt(session, PROMPT)
    console.log(`[PHASE 2] Prompt sent with id=${promptId}`)
  } catch (err) {
    console.log(`[FATAL] sendPrompt failed: ${err}`)
    closeAcpSession(session)
    process.exit(1)
  }

  // Phase 3 — drain all events
  console.log("\n[PHASE 3] Draining events...\n")
  let eventCount = 0
  let textChunks = 0
  let reasoningChunks = 0
  let toolCalls = 0
  let toolCallUpdates = 0
  const allText: string[] = []
  const allReasoning: string[] = []

  let foundThinking = false

  while (true) {
    let event: AcpEvent | null
    try {
      event = await nextAcpEvent(session, promptId)
    } catch (err) {
      console.log(`[ERROR] nextAcpEvent threw: ${err}`)
      break
    }

    if (!event) {
      console.log("[STREAM] Stream ended (null event)")
      break
    }

    eventCount++

    switch (event.type) {
      case "text_delta":
        textChunks++
        allText.push(event.text)
        console.log(`[EVENT #${eventCount}] type=text_delta     text="${event.text.slice(0, 80)}${event.text.length > 80 ? "..." : ""}"`)
        break

      case "reasoning_delta":
        reasoningChunks++
        allReasoning.push(event.text)
        foundThinking = true
        console.log(`[EVENT #${eventCount}] type=reasoning_delta *** FOUND THINKING EVENT *** text="${event.text.slice(0, 80)}${event.text.length > 80 ? "..." : ""}"`)
        break

      case "tool_call":
        toolCalls++
        console.log(`[EVENT #${eventCount}] type=tool_call       id=${event.id} name=${event.name} status=${event.status}`)
        break

      case "tool_call_update":
        toolCallUpdates++
        console.log(`[EVENT #${eventCount}] type=tool_call_update id=${event.id} status=${event.status}`)
        break

      case "end_turn":
        console.log(`[EVENT #${eventCount}] type=end_turn        stopReason=${event.stopReason}`)
        break
    }
  }

  // Phase 4 — summary
  console.log("\n" + "=" .repeat(70))
  console.log("SUMMARY")
  console.log("=" .repeat(70))
  console.log(`Total events:         ${eventCount}`)
  console.log(`text_delta chunks:    ${textChunks}`)
  console.log(`reasoning_delta:      ${reasoningChunks}`)
  console.log(`tool_call:            ${toolCalls}`)
  console.log(`tool_call_update:     ${toolCallUpdates}`)
  console.log(`Full text:            ${allText.join("").slice(0, 500)}`)
  if (allReasoning.length > 0) {
    console.log(`Full reasoning:       ${allReasoning.join("").slice(0, 500)}`)
  }

  if (foundThinking) {
    console.log("\n*** RESULT: THINKING/REASONING CONTENT DETECTED ***")
    console.log(`Agent sent ${reasoningChunks} agent_thought_chunk notification(s).`)
  } else {
    console.log("\n!!! RESULT: NO THINKING/REASONING CONTENT DETECTED !!!")
    console.log(`Agent sent 0 agent_thought_chunk notifications.`)
    console.log(`The model (${MODEL}) may not support thinking, or `)
    console.log(`the ACP protocol may not relay thought chunks.`)
  }

  // Cleanup
  closeAcpSession(session)
  console.log("\n[TEARDOWN] Session closed.")
}

main().catch((err) => {
  console.error("\n[FATAL] Unhandled error in probe:")
  console.error(err)
  process.exit(1)
})
