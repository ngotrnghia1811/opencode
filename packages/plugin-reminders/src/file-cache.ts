import { DEFAULT_MAX_FILE_BYTES } from "./config.ts"

type Entry = {
  mtimeMs: number
  size: number
  text: string
}

const cache = new Map<string, Entry>()

export type ReadResult = {
  text: string
  truncated: boolean
  path: string
}

// Returns undefined if the file does not exist or cannot be read.
// On size > maxBytes the text is truncated and a marker is appended;
// `truncated: true` is reported so callers can surface the condition.
export async function readCached(absPath: string, maxBytes = DEFAULT_MAX_FILE_BYTES): Promise<ReadResult | undefined> {
  const file = Bun.file(absPath)
  const exists = await file.exists()
  if (!exists) return undefined
  const size = file.size
  const mtime = file.lastModified
  const cached = cache.get(absPath)
  if (cached && cached.mtimeMs === mtime && cached.size === size) {
    return { text: cached.text, truncated: cached.text.length < size, path: absPath }
  }
  const raw = await file.text()
  const truncated = raw.length > maxBytes
  const text = truncated ? raw.slice(0, maxBytes) + `\n... [reminders: file truncated at ${maxBytes} bytes]` : raw
  cache.set(absPath, { mtimeMs: mtime, size, text })
  return { text, truncated, path: absPath }
}

export function clearCache(): void {
  cache.clear()
}
