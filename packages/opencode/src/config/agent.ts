export * as ConfigAgent from "./agent"

import path from "path"
import { Exit, Schema } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigParse } from "./parse"

// Origin is derived provenance, not a persisted config field. `file` is the highest-precedence config file that
// mentions the agent and `value` is the highest-precedence file that sets its model or variant. Config loading
// merges origins with the same mergeDeep calls it uses for the agent configs, so later layers win the same way.
export type Origin = {
  file: string
  value?: string
}

export function origin(file: string, agent: { model?: string; variant?: string } | undefined): Origin {
  if (agent?.model === undefined && agent?.variant === undefined) return { file }
  return { file, value: file }
}

export async function load(dir: string, origins: Record<string, Origin> = {}) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["agent/", "agents/"])

    const config = {
      name,
      ...md.data,
      prompt: md.content.trim(),
    }
    result[config.name] = ConfigParse.schema(ConfigAgentV1.Info, config, item)
    origins[config.name] = origin(item, result[config.name])
  }
  return result
}

export async function loadMode(dir: string, origins: Record<string, Origin> = {}) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const config = {
      name: configEntryNameFromPath(path.relative(dir, item), ["mode/", "modes/"]),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Schema.decodeUnknownExit(ConfigAgentV1.Info)(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      result[config.name] = {
        ...parsed.value,
        mode: "primary" as const,
      }
      origins[config.name] = origin(item, parsed.value)
    }
  }
  return result
}
