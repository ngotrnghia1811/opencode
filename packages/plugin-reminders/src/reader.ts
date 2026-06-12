import path from "node:path"

export interface QAEntry {
  time: string
  agentName: string
  sessionId: string
  parentId: string | null
  question: string
  answer: string
}

export interface PlanEntry {
  time: string
  agentName: string
  sessionId: string
  parentId: string | null
  items: string[]
}

// Read Q-A entries from today's file, optionally filtered by sessionId or agentName.
export async function readQA(
  remindersDir: string,
  date: string,
  filter?: { sessionId?: string; agentName?: string },
): Promise<QAEntry[]> {
  const filePath = path.join(remindersDir, "qa", `qa-memory-${date}.md`)
  const content = await tryRead(filePath)
  if (content !== undefined) return parseQANew(content, filter)
  // Backward compat: try old per-session file.
  if (filter?.sessionId) {
    const oldPath = path.join(remindersDir, "sessions", `qa-memory-${filter.sessionId}.md`)
    const oldContent = await tryRead(oldPath)
    if (oldContent !== undefined) {
      console.warn(
        `[plugin-reminders] reading from legacy per-session file: ${oldPath}. ` +
          `Entries should be migrated to qa/qa-memory-YYYY-MM-DD.md.`,
      )
      return parseQAOld(oldContent, filter)
    }
  }
  return []
}

// Read evolving-plan entries from today's file.
export async function readPlan(
  remindersDir: string,
  date: string,
  filter?: { sessionId?: string; agentName?: string },
): Promise<PlanEntry[]> {
  const filePath = path.join(remindersDir, "plan", `evolving-plan-${date}.md`)
  const content = await tryRead(filePath)
  if (content !== undefined) return parsePlanNew(content, filter)
  // Backward compat: try old per-session file.
  if (filter?.sessionId) {
    const oldPath = path.join(remindersDir, "sessions", `todo-${filter.sessionId}.md`)
    const oldContent = await tryRead(oldPath)
    if (oldContent !== undefined) {
      console.warn(
        `[plugin-reminders] reading from legacy per-session file: ${oldPath}. ` +
          `Entries should be migrated to plan/evolving-plan-YYYY-MM-DD.md.`,
      )
      return parsePlanOld(oldContent, filter)
    }
  }
  return []
}

async function tryRead(absPath: string): Promise<string | undefined> {
  const file = Bun.file(absPath)
  const exists = await file.exists()
  if (!exists) return undefined
  return file.text()
}

// ——— NEW format parsers ———

function parseQANew(content: string, filter?: { sessionId?: string; agentName?: string }): QAEntry[] {
  const entries: QAEntry[] = []
  // Skip the `# YYYY-MM-DD` header line.
  const body = content.replace(/^# .*\n/, "")
  const sections = body.split(/\n(?=## \d{2}:\d{2} )/)
  for (const section of sections) {
    const entry = parseQANewSection(section)
    if (!entry) continue
    if (filter?.sessionId && entry.sessionId !== filter.sessionId) continue
    if (filter?.agentName && entry.agentName !== filter.agentName) continue
    entries.push(entry)
  }
  return entries
}

function parseQANewSection(section: string): QAEntry | null {
  const lines = section.split("\n")
  const headerLine = lines[0] ?? ""
  const headerMatch = headerLine.match(/^## (\d{2}:\d{2}) (\S+) (\S+)(?: ← (\S+))?$/)
  if (!headerMatch) return null
  const [, time, agentName, sessionId, parentId] = headerMatch
  let question = ""
  let answer = ""
  let inQ = false
  let inA = false
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (line.startsWith("Q: ")) {
      question = line.slice(3)
      inQ = true
      inA = false
    } else if (line.startsWith("A: ")) {
      answer = line.slice(3)
      inQ = false
      inA = true
    } else if (line === "" || line.startsWith("## ")) {
      inQ = false
      inA = false
    } else if (inQ) {
      question += "\n" + line
    } else if (inA) {
      answer += "\n" + line
    }
  }
  if (!time || !agentName || !sessionId) return null
  return { time, agentName, sessionId, parentId: parentId ?? null, question, answer }
}

function parsePlanNew(content: string, filter?: { sessionId?: string; agentName?: string }): PlanEntry[] {
  const entries: PlanEntry[] = []
  const body = content.replace(/^# .*\n/, "")
  const sections = body.split(/\n(?=## \d{2}:\d{2} )/)
  for (const section of sections) {
    const entry = parsePlanNewSection(section)
    if (!entry) continue
    if (filter?.sessionId && entry.sessionId !== filter.sessionId) continue
    if (filter?.agentName && entry.agentName !== filter.agentName) continue
    entries.push(entry)
  }
  return entries
}

function parsePlanNewSection(section: string): PlanEntry | null {
  const lines = section.split("\n")
  const headerLine = lines[0] ?? ""
  const headerMatch = headerLine.match(/^## (\d{2}:\d{2}) (\S+) (\S+)(?: ← (\S+))?$/)
  if (!headerMatch) return null
  const [, time, agentName, sessionId, parentId] = headerMatch
  const items: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (line.startsWith("- ")) items.push(line)
    else if (line === "") continue
    else break // stop at first non-item, non-empty line
  }
  if (!time || !agentName || !sessionId) return null
  return { time, agentName, sessionId, parentId: parentId ?? null, items }
}

// ——— OLD format parsers (backward compat) ———

function parseQAOld(content: string, filter?: { sessionId?: string; agentName?: string }): QAEntry[] {
  const entries: QAEntry[] = []
  // Try the full-format sections first: ## YYYY-MM-DD HH:MM — topic
  const sections = content.split(/\n(?=## \d{4}-\d{2}-\d{2} \d{2}:\d{2} )/)
  for (const section of sections) {
    const entry = parseQAOldFull(section)
    if (entry) {
      if (filter?.sessionId && entry.sessionId !== filter.sessionId) continue
      if (filter?.agentName && entry.agentName !== filter.agentName) continue
      entries.push(entry)
    }
  }
  // Also try the simple `**Q:** ... **A:** ...` format (no ## prefix).
  const simpleEntries = parseQAOldSimple(content, filter)
  entries.push(...simpleEntries)
  return entries
}

function parseQAOldFull(section: string): QAEntry | null {
  const headerMatch = section.match(/^## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) — .+/)
  if (!headerMatch) return null
  const [, , time] = headerMatch
  const askedMatch = section.match(/\*\*Asked by:\*\* (.+)/)
  const sessionMatch = section.match(/\*\*Session:\*\* (.+)/)
  const qMatch = section.match(/\*\*Q:\*\* (.+)/)
  const aMatch = section.match(/\*\*A:\*\* (.+)/)
  if (!askedMatch || !sessionMatch) return null
  return {
    time: time ?? "",
    agentName: askedMatch[1]?.trim() ?? "",
    sessionId: sessionMatch[1]?.trim() ?? "",
    parentId: null,
    question: qMatch?.[1]?.trim() ?? "",
    answer: aMatch?.[1]?.trim() ?? "",
  }
}

function parseQAOldSimple(content: string, filter?: { sessionId?: string; agentName?: string }): QAEntry[] {
  const entries: QAEntry[] = []
  let sessionId = ""
  // Try to extract session ID from the header.
  const sesMatch = content.match(/Session (\S+)/)
  if (sesMatch) sessionId = sesMatch[1] ?? ""
  if (filter?.sessionId && sessionId !== filter.sessionId) return entries
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (line.startsWith("**Q:** ")) {
      const question = line.slice(6).trim()
      const nextLine = lines[i + 1] ?? ""
      const answer = nextLine.startsWith("**A:** ") ? nextLine.slice(6).trim() : ""
      entries.push({
        time: "",
        agentName: "",
        sessionId,
        parentId: null,
        question,
        answer,
      })
    }
  }
  return entries
}

function parsePlanOld(content: string, filter?: { sessionId?: string; agentName?: string }): PlanEntry[] {
  const entries: PlanEntry[] = []
  let sessionId = ""
  const sesMatch = content.match(/Session (\S+)/)
  if (sesMatch) sessionId = sesMatch[1] ?? ""
  if (filter?.sessionId && sessionId !== filter.sessionId) return entries
  const lines = content.split("\n")
  let inItems = false
  const items: string[] = []
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inItems && items.length > 0) {
        entries.push({ time: "", agentName: "", sessionId, parentId: null, items: [...items] })
        items.length = 0
      }
      inItems = true
      continue
    }
    if (inItems && line.startsWith("- ")) {
      items.push(line)
    }
  }
  if (inItems && items.length > 0) {
    entries.push({ time: "", agentName: "", sessionId, parentId: null, items: [...items] })
  }
  return entries
}
