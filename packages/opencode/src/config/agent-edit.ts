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
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import { isRecord } from "@/util/record"
import { ConfigPaths } from "./paths"

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
  path: Schema.String,
  changed: Schema.Boolean,
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

// Writes the model/variant override of one agent into `file`, or into the project config when the agent has no
// config file. The running instance is not reloaded, so the change applies after restart.
export const update = Effect.fn("ConfigAgentEdit.update")(function* (input: {
  name: string
  file?: string
  directory: string
  worktree: string
  patch: Patch
}) {
  const fs = yield* FSUtil.Service
  const patch = {
    model: input.patch.model?.trim(),
    variant: input.patch.variant?.trim(),
  }
  if (patch.model && !/^[^/\s]+\/\S+$/.test(patch.model))
    return yield* new EditError({ message: `Model must look like provider/model, got "${patch.model}"` })

  const file = input.file ?? (yield* projectTarget(input.directory, input.worktree))
  const before = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
  if (before === undefined && input.file) return yield* new EditError({ message: `Config file ${file} is missing` })
  const text = before ?? EMPTY_JSON
  const after = yield* Effect.try({
    try: () => (file.endsWith(".md") ? patchMarkdown(text, patch) : patchJson(text, input.name, patch)),
    catch: (error) =>
      new EditError({ message: `Cannot edit ${file}: ${error instanceof Error ? error.message : String(error)}` }),
  })
  if (after === text) return { path: file, changed: false }
  yield* fs
    .writeWithDirs(file, after)
    .pipe(Effect.mapError((error) => new EditError({ message: `Cannot write ${file}: ${error.message}` })))
  return { path: file, changed: true }
})

// Built-in agents have no config file. Their override goes to the highest-precedence project opencode.json(c),
// else to .opencode/opencode.json(c) at the project root, which is created when missing.
const projectTarget = Effect.fnUntraced(function* (directory: string, worktree: string) {
  const fs = yield* FSUtil.Service
  const files = yield* ConfigPaths.files("opencode", directory, worktree).pipe(Effect.orElseSucceed(() => []))
  const nearest = files.at(-1)
  if (nearest) return nearest
  const dir = path.join(worktree === "/" ? directory : worktree, ".opencode")
  if (yield* fs.existsSafe(path.join(dir, "opencode.jsonc"))) return path.join(dir, "opencode.jsonc")
  return path.join(dir, "opencode.json")
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

// Patches the `model:` / `variant:` frontmatter keys. The body and all other frontmatter lines stay byte-identical.
export function patchMarkdown(text: string, patch: Patch) {
  const fields = FIELDS.filter((field) => patch[field] !== undefined)
  const open = text.match(/^\uFEFF?---[ \t]*(\r?\n)/)
  if (!open) {
    const lines = fields.flatMap((field) => (patch[field] ? [`${field}: ${yaml(patch[field])}`] : []))
    if (!lines.length) return text
    // gray-matter accepts a few opening lines that the regex above does not, such as `---yaml`.
    if (ConfigMarkdown.parseOption(text)?.matter) throw new EditError({ message: "unsupported frontmatter layout" })
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    return verify(["---", ...lines, "---", ""].join(eol) + text, patch)
  }
  const start = open[0].length
  const end = text.slice(start).search(/^---[ \t]*\r?$/m)
  if (end === -1) throw new EditError({ message: "frontmatter has no closing ---" })
  const block = fields.reduce(
    (result, field) => setKey(result, field, patch[field] ?? "", open[1]),
    text.slice(start, start + end),
  )
  return verify(text.slice(0, start) + block + text.slice(start + end), patch)
}

// Rewrites one top-level key of a frontmatter block that ends with a newline. Indented lines after the key belong
// to its value (for example a block scalar) and are replaced or removed with it.
function setKey(block: string, key: (typeof FIELDS)[number], value: string, eol: string) {
  const lines = block.split("\n")
  const entry = (name: string) => {
    const start = lines.findIndex((line) => new RegExp(`^${name}[ \\t]*:`).test(line))
    if (start === -1) return undefined
    const rest = lines.slice(start + 1).findIndex((line) => !/^[ \t]+\S/.test(line))
    return { start, end: rest === -1 ? lines.length : start + 1 + rest }
  }
  const replacement = value ? [`${key}: ${yaml(value)}${eol === "\r\n" ? "\r" : ""}`] : []
  const current = entry(key)
  if (current) return [...lines.slice(0, current.start), ...replacement, ...lines.slice(current.end)].join("\n")
  if (!value) return block
  // Keep model and variant next to each other when the other one already exists.
  const at = (key === "variant" ? entry("model")?.end : entry("variant")?.start) ?? lines.length - 1
  return [...lines.slice(0, at), ...replacement, ...lines.slice(at)].join("\n")
}

// Keep plain YAML scalars for ordinary ids such as `anthropic/claude-sonnet-4` or `openrouter/qwen3:free`. Quote
// anything that YAML could read as another type or syntax.
function yaml(value: string) {
  if (/^[A-Za-z_][\w./@+-]*(?::[\w./@+-]+)*$/.test(value) && !/^(true|false|yes|no|on|off|null|y|n)$/i.test(value))
    return value
  return JSON.stringify(value)
}

// A broken frontmatter makes opencode skip the agent at startup, so re-parse before anything is written.
function verify(text: string, patch: Patch) {
  const data = ConfigMarkdown.parseOption(text)?.data
  const ok =
    isRecord(data) && FIELDS.every((field) => patch[field] === undefined || (data[field] ?? "") === patch[field])
  if (!ok) throw new EditError({ message: "the updated frontmatter does not parse back to the requested values" })
  return text
}
