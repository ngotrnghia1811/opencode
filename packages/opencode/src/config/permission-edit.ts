export * as ConfigPermissionEdit from "./permission-edit"

import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { isRecord } from "@/util/record"
import { ConfigAgentEdit } from "./agent-edit"

export const Input = Schema.Struct({
  permission: Schema.String.annotate({ description: "Permission key of the request, for example bash or edit" }),
  patterns: Schema.Array(Schema.String).annotate({
    description: "Patterns to allow, usually the `always` patterns of the permission request",
  }),
})
export type Input = Schema.Schema.Type<typeof Input>

export const Result = Schema.Struct({
  path: Schema.String.annotate({ description: "Global config file that received the rules" }),
  changed: Schema.Boolean,
}).annotate({ identifier: "PermissionConfigUpdateResult" })
export type Result = Schema.Schema.Type<typeof Result>

export class EditError extends Schema.TaggedErrorClass<EditError>()("ConfigPermissionEditError", {
  message: Schema.String,
}) {}

// Writes `permission.<permission>.<pattern>: "allow"` into the same global config file that agent edits use, so
// future sessions of this workspace do not ask again. The running instance is not reloaded. The caller replies
// "always" to the pending request to cover the current run.
export const allow = Effect.fn("ConfigPermissionEdit.allow")(function* (input: Input) {
  const fs = yield* FSUtil.Service
  const permission = input.permission.trim()
  const patterns = input.patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0)
  if (!permission) return yield* new EditError({ message: "Permission must not be empty" })
  if (patterns.length === 0) return yield* new EditError({ message: "At least one pattern is required" })
  const file = (yield* ConfigAgentEdit.globalFile()).file
  const text =
    (yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))) ?? ConfigAgentEdit.EMPTY_JSON
  const after = yield* Effect.try({
    try: () => patchJson(text, permission, patterns),
    catch: (error) =>
      new EditError({ message: `Cannot edit ${file}: ${error instanceof Error ? error.message : String(error)}` }),
  })
  if (after === text) return { path: file, changed: false }
  yield* fs
    .writeWithDirs(file, after)
    .pipe(Effect.mapError((error) => new EditError({ message: `Cannot write ${file}: ${error.message}` })))
  return { path: file, changed: true }
})

// Adds allow rules with minimal JSONC edits. Comments, formatting, and all other keys stay as they are.
// Permission rules evaluate last-match-wins in key order, so every new or changed pattern goes to the end of its
// object, after broader rules such as `"*": "ask"`.
export function patchJson(text: string, permission: string, patterns: readonly string[]) {
  const errors: ParseError[] = []
  const data = parse(text, errors, { allowTrailingComma: true })
  const error = errors.at(0)
  if (error)
    throw new EditError({
      message: `invalid JSON at line ${text.slice(0, error.offset).split("\n").length}: ${printParseErrorCode(error.error)}`,
    })
  if (!isRecord(data)) throw new EditError({ message: "config root is not an object" })
  const formattingOptions = ConfigAgentEdit.formatting(text)
  const edit = (source: string, path: string[], value: unknown) =>
    applyEdits(source, modify(source, path, value, { formattingOptions }))

  // A top-level action such as `"permission": "ask"` means `{ "*": "ask" }`. Expand it so a tool key can follow it.
  const root = typeof data.permission === "string" ? edit(text, ["permission"], { "*": data.permission }) : text
  const current = isRecord(data.permission) ? data.permission[permission] : undefined
  if (current === "allow") return root
  // Some keys (question, webfetch, todowrite, ...) accept only an action string, and their requests use "*".
  if (patterns.includes("*") && !isRecord(current)) return edit(root, ["permission", permission], "allow")
  // An action string such as "ask" means `{ "*": "ask" }`. Keep it first so the new patterns win over it.
  const base = typeof current === "string" ? edit(root, ["permission", permission], { "*": current }) : root
  return patterns.reduce((source, pattern) => {
    const value = isRecord(current) ? current[pattern] : undefined
    if (value === "allow") return source
    const cleared = value === undefined ? source : edit(source, ["permission", permission, pattern], undefined)
    return edit(cleared, ["permission", permission, pattern], "allow")
  }, base)
}
