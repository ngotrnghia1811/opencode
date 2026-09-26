export * as ConfigAgentEdit from "./agent-edit"

import path from "path"
import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser"
import { Effect, Option, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { isRecord } from "@/util/record"
import type { ConfigAgent } from "./agent"

export const Input = Schema.Struct({
  name: Schema.String.annotate({ description: "Agent name as listed by the agent list route" }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model as provider/model. An empty string removes the override. Omit to keep the current value.",
  }),
  variant: Schema.optional(Schema.String).annotate({
    description: "Model variant. An empty string removes the override. Omit to keep the current value.",
  }),
})
export type Input = Schema.Schema.Type<typeof Input>

export const Result = Schema.Struct({
  path: Schema.String.annotate({ description: "Global config file that received the override" }),
  changed: Schema.Boolean,
  shadowed_by: Schema.optional(Schema.String).annotate({
    description:
      "Config file that loads after the global config and sets a patched field, so the override does not take effect",
  }),
}).annotate({ identifier: "AgentConfigUpdateResult" })
export type Result = Schema.Schema.Type<typeof Result>

export class EditError extends Schema.TaggedErrorClass<EditError>()("ConfigAgentEditError", {
  message: Schema.String,
}) {}

// An omitted field keeps the current value. An empty string removes the key.
export type Patch = {
  model?: string
  variant?: string
}

const FIELDS = ["model", "variant"] as const
const EMPTY_JSON = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
// The global config files in the order Config.loadGlobal merges them, so a later file wins over an earlier one.
const GLOBAL_FILES = ["config.json", "opencode.json", "opencode.jsonc"]

// Writes the model/variant override of one agent into the highest-precedence global config file that exists, else
// into a new global opencode.json. Project config files and markdown agents load after the global config, so
// `shadowed_by` names a file from `origin` that sets a patched field and keeps the override from taking effect.
// The running instance is not reloaded, so the change applies after restart.
export const update = Effect.fn("ConfigAgentEdit.update")(function* (input: {
  name: string
  patch: Patch
  origin?: ConfigAgent.Origin
}) {
  const fs = yield* FSUtil.Service
  const patch = {
    model: input.patch.model?.trim(),
    variant: input.patch.variant?.trim(),
  }
  if (patch.model && !/^[^/\s]+\/\S+$/.test(patch.model))
    return yield* new EditError({ message: `Model must look like provider/model, got "${patch.model}"` })

  const files = GLOBAL_FILES.map((name) => path.join(Global.Path.config, name))
  const file = Option.getOrElse(
    yield* Effect.findFirst(files.toReversed(), (candidate) => fs.existsSafe(candidate)),
    () => path.join(Global.Path.config, "opencode.json"),
  )
  // The target is the highest-precedence global file that exists, so another global file never shadows it.
  const shadow = FIELDS.filter((field) => patch[field] !== undefined)
    .map((field) => input.origin?.[field])
    .find((source) => source !== undefined && !files.includes(source))
  // The HTTP encoder turns an undefined value into null, so leave the key out when nothing shadows the write.
  const result = { path: file, ...(shadow === undefined ? {} : { shadowed_by: shadow }) }
  const before = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
  const text = before ?? EMPTY_JSON
  const after = yield* Effect.try({
    try: () => patchJson(text, input.name, patch),
    catch: (error) =>
      new EditError({ message: `Cannot edit ${file}: ${error instanceof Error ? error.message : String(error)}` }),
  })
  if (after === text) return { ...result, changed: false }
  yield* fs
    .writeWithDirs(file, after)
    .pipe(Effect.mapError((error) => new EditError({ message: `Cannot write ${file}: ${error.message}` })))
  return { ...result, changed: true }
})

// Patches `agent.<name>.model` / `agent.<name>.variant` with minimal JSONC edits. Comments, formatting, and all
// other keys stay as they are.
export function patchJson(text: string, name: string, patch: Patch) {
  const errors: ParseError[] = []
  const data = parse(text, errors, { allowTrailingComma: true })
  const error = errors.at(0)
  if (error)
    throw new EditError({
      message: `invalid JSON at line ${text.slice(0, error.offset).split("\n").length}: ${printParseErrorCode(error.error)}`,
    })
  if (!isRecord(data)) throw new EditError({ message: "config root is not an object" })
  const key = container(data, name)
  const formattingOptions = formatting(text)
  // New keys are inserted first in their object, so write variant before model to end up with model, variant.
  return FIELDS.toReversed().reduce((result, field) => {
    const value = patch[field]
    if (value === undefined) return result
    if (!value) return removeKey(result, [key, name, field], formattingOptions)
    return applyEdits(
      result,
      modify(result, [key, name, field], value, {
        formattingOptions,
        // jsonc-parser reformats the whole line it inserts after, including trailing comments. Insert new keys
        // right after the opening brace (or `$schema`) so siblings such as `"plugin": ["x"]` keep their layout.
        getInsertionIndex: (keys) => keys.indexOf("$schema") + 1,
      }),
    )
  }, text)
}

// jsonc-parser deletes from the end of the previous sibling, which drops that sibling's trailing comment and can
// join the next sibling onto the brace line. When the property sits on its own line, delete just that line.
function removeKey(text: string, path: string[], formattingOptions: FormattingOptions) {
  const tree = parseTree(text, [], { allowTrailingComma: true })
  const property = tree && findNodeAtLocation(tree, path)?.parent
  const siblings = property?.parent?.children
  if (!property || !siblings) return text
  const start = text.lastIndexOf("\n", property.offset - 1) + 1
  const end = text.indexOf("\n", property.offset + property.length)
  const tail =
    end === -1
      ? undefined
      : text.slice(property.offset + property.length, end).match(/^[ \t]*(,?)[ \t]*(\/\/[^\r\n]*)?\r?$/)
  if (text.slice(start, property.offset).trim() || !tail)
    return applyEdits(text, modify(text, path, undefined, { formattingOptions }))
  const lines = text.slice(0, start) + text.slice(end + 1)
  const previous = siblings[siblings.indexOf(property) - 1]
  if (tail[1] || !previous) return lines
  // The removed property was last and had no comma, so the previous sibling's separator comma goes too. The scanner
  // skips whitespace and comments, and only a comma token starts with ",".
  const scanner = createScanner(lines, true)
  scanner.setPosition(previous.offset + previous.length)
  scanner.scan()
  const comma = scanner.getTokenOffset()
  if (lines[comma] !== ",") return lines
  return lines.slice(0, comma) + lines.slice(comma + 1)
}

// Legacy files can define an agent under the deprecated `mode` key. V2 `agents` entries use another model syntax,
// and a new legacy `agent` entry would replace them, so refuse to edit those.
function container(data: Record<string, unknown>, name: string) {
  if (isRecord(data.agent) && name in data.agent) return "agent"
  if (isRecord(data.mode) && name in data.mode) return "mode"
  if (isRecord(data.agents) && name in data.agents)
    throw new EditError({ message: `agent "${name}" uses the v2 "agents" key, edit it by hand` })
  return "agent"
}

function formatting(text: string) {
  const indent = text.match(/^([ \t]+)\S/m)?.[1] ?? "  "
  return {
    insertSpaces: !indent.startsWith("\t"),
    tabSize: indent.startsWith("\t") ? 4 : indent.length,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  }
}
