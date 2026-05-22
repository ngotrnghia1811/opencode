import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import { AckSchema } from "./ack-schema"

// Candidate dirs where verdict-<id>.yaml may live, in priority order.
// aki-eval is the F12 legacy producer; future aki-judge dir is added here
// when F13 lands without changing the call surface.
const VERDICT_DIRS = [".opencode/aki-eval", ".opencode/aki-judge"] as const

interface WriteAckParams {
  verdict_id: string
  finding_id: string
  status: AckSchema.AckEntry["status"]
  note?: string
}

interface WriteAckResult {
  path: string
  total: number
}

// Resolves the directory holding `verdict-<id>.yaml` and writes/merges
// `ack-<id>.yaml` alongside it. Re-acking the same finding_id replaces the
// prior entry; new findings append. If no matching verdict file is found,
// the ack is written under the first candidate dir so the caller error
// surfaces during scorer audit rather than blocking the user.
export async function writeAck(cwd: string, params: WriteAckParams): Promise<WriteAckResult> {
  const verdictDir = await resolveVerdictDir(cwd, params.verdict_id)
  const ackPath = path.join(verdictDir, `ack-${params.verdict_id}.yaml`)
  await fs.mkdir(verdictDir, { recursive: true })

  const existing = await fs.readFile(ackPath, "utf-8").then(
    (s) => YAML.parse(s) as AckSchema.AckFile,
    () => ({ verdict_id: params.verdict_id, acks: [] }) as AckSchema.AckFile,
  )
  const entry: AckSchema.AckEntry = {
    verdict_id: params.verdict_id,
    finding_id: params.finding_id,
    status: params.status,
    note: params.note,
    created_at: new Date().toISOString(),
  }
  const next: AckSchema.AckFile = {
    verdict_id: params.verdict_id,
    acks: [...existing.acks.filter((a) => a.finding_id !== params.finding_id), entry],
  }
  await fs.writeFile(ackPath, YAML.stringify(next), "utf-8")
  return { path: ackPath, total: next.acks.length }
}

async function resolveVerdictDir(cwd: string, verdict_id: string): Promise<string> {
  for (const rel of VERDICT_DIRS) {
    const abs = path.join(cwd, rel)
    const exists = await fs.stat(path.join(abs, `verdict-${verdict_id}.yaml`)).then(
      () => true,
      () => false,
    )
    if (exists) return abs
  }
  return path.join(cwd, VERDICT_DIRS[0])
}
