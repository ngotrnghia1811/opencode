import path from "path"
import fs from "fs/promises"
import YAML from "yaml"
import { ObservationAckSchema } from "./ack-schema"

const ACK_DIR = ".opencode/aki-sidekick" as const

interface WriteObservationAckParams {
  observation_id: string
  status: ObservationAckSchema.ObservationAckEntry["status"]
  note?: string
}

interface WriteObservationAckResult {
  path: string
  total: number
}

export async function writeObservationAck(cwd: string, params: WriteObservationAckParams): Promise<WriteObservationAckResult> {
  const ackDir = path.join(cwd, ACK_DIR)
  const ackPath = path.join(ackDir, "ack-observations.yaml")
  await fs.mkdir(ackDir, { recursive: true })

  const existing = await fs.readFile(ackPath, "utf-8").then(
    (s) => YAML.parse(s) as ObservationAckSchema.ObservationAckFile,
    () => ({ acks: [] }) as ObservationAckSchema.ObservationAckFile,
  )
  const entry: ObservationAckSchema.ObservationAckEntry = {
    observation_id: params.observation_id,
    status: params.status,
    note: params.note,
    created_at: new Date().toISOString(),
  }
  const next: ObservationAckSchema.ObservationAckFile = {
    acks: [...existing.acks.filter((a) => a.observation_id !== params.observation_id), entry],
  }
  await fs.writeFile(ackPath, YAML.stringify(next), "utf-8")
  return { path: ackPath, total: next.acks.length }
}
