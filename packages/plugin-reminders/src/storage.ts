import path from "node:path"

// Append a Q-A entry to qa/qa-memory-YYYY-MM-DD.md.
export async function appendQA(
  remindersDir: string,
  date: string,
  time: string,
  agentName: string,
  sessionId: string,
  parentId: string | null,
  question: string,
  answer: string,
): Promise<void> {
  const qaDir = path.join(remindersDir, "qa")
  const filePath = path.join(qaDir, `qa-memory-${date}.md`)
  const parent = parentId ? ` ← ${parentId}` : ""
  const entry = `\n## ${time} ${agentName} ${sessionId}${parent}\nQ: ${question}\nA: ${answer}\n`
  await appendFile(filePath, date, entry)
}

// Append an evolving-plan entry to plan/evolving-plan-YYYY-MM-DD.md.
export async function appendPlan(
  remindersDir: string,
  date: string,
  time: string,
  agentName: string,
  sessionId: string,
  parentId: string | null,
  items: string[],
): Promise<void> {
  const planDir = path.join(remindersDir, "plan")
  const filePath = path.join(planDir, `evolving-plan-${date}.md`)
  const parent = parentId ? ` ← ${parentId}` : ""
  const itemsBlock = items.map((i) => `${i}`).join("\n")
  const entry = `\n## ${time} ${agentName} ${sessionId}${parent}\n${itemsBlock}\n`
  await appendFile(filePath, date, entry)
}

async function appendFile(absPath: string, date: string, content: string): Promise<void> {
  const file = Bun.file(absPath)
  const existed = await file.exists()
  if (existed) {
    const existing = await file.text()
    await Bun.write(absPath, existing + content)
    return
  }
  // Bun.write creates parent directories automatically.
  await Bun.write(absPath, `# ${date}\n${content}`)
}
