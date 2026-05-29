# @opencode-ai/plugin-reminders

File-based reminders on opencode lifecycle events.

> **Status:** wired. All 4 hooks fire. See
> [`future/future-file-reminders.md`](../../../future/future-file-reminders.md)
> in the workspace root for the full design (trigger grammar, modes,
> hook map, test plan, open questions).

## What it does

On a configured lifecycle event (tool call, subagent dispatch,
compaction, every model turn), reads a file from disk and injects its
contents as a `<system-reminder>` into the model's context for its
next turn.

## Configuration (`opencode.json`)

```jsonc
{
  "plugin": [
    [
      "/abs/path/to/plugin-reminders",
      {
        "enabled": true,
        "rules": [
          { "trigger": "before:tool:question",
            "file": ".opencode/reminders/before-question.md" },

          { "trigger": "before:dispatch:*",
            "file": ".opencode/reminders/before-dispatch.md" },

          { "trigger": "every:turn:aki-main",
            "file": ".opencode/reminders/qa-memory-{sessionID}.md" },

          { "trigger": "before:compaction",
            "file": ".opencode/reminders/compaction-policy.md",
            "mode": "replace" }
        ]
      }
    ]
  ]
}
```

## Trigger grammar (v1)

| Trigger                                | Fires                                                |
| -------------------------------------- | ---------------------------------------------------- |
| `before:tool:<id\|*>`                  | Just before a tool executes                          |
| `after:tool:<id\|*>`                   | Just after a tool returns                            |
| `before:dispatch:<agent\|*>`           | Before parent dispatches a subagent via `task`       |
| `after:dispatch:<agent\|*>`            | After subagent returns to parent (foreground) / starts (background) |
| `before:compaction`                    | Just before the compaction agent runs                |
| `every:turn:<agent\|*>`                | Before each LLM call for the named agent             |
| `on:event:<name>` *(v1.1)*             | Reserved — requires the `emit_event` tool            |

## Modes

| `mode`                | Effect                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| `reminder` *(default)*| Wrap in `<system-reminder source="...">…</system-reminder>` and append  |
| `append`              | Append verbatim, no wrapper                                             |
| `replace`             | **`before:compaction` only** — replaces the compaction prompt           |
| `tool-result-prefix`  | **`after:tool:*` only** — prepended to the tool result the model sees   |

> ⚠ `mode: "replace"` short-circuits opencode's built-in compaction
> prompt. If the replacement file is empty or unreadable the plugin
> falls back to the built-in prompt.

## Template tokens

Both `rule.file` paths and the contents of loaded files support
substitution of:

| Token         | Expands to                                                  |
| ------------- | ----------------------------------------------------------- |
| `{sessionID}` | The current session's ID (e.g. `sess_abc123`)               |
| `{agent}`     | The name of the active agent (e.g. `aki-main`, `aki-build`) |

Example: `"file": ".opencode/reminders/qa-memory-{sessionID}.md"` reads
a different file per session. A reminder file containing `append to
.opencode/reminders/qa-memory-{sessionID}.md` will be substituted before
injection so the agent sees the resolved path.

If a rule's file path or contents reference a token whose value is not
yet known (e.g. `{agent}` before the first `chat.message` has fired in
the session), the rule is silently skipped for that invocation.

## Bounding injection size

Per-rule `tail_bytes` caps how much of the file is injected by keeping
only the *last* N bytes of the resolved content. Useful for append-only
logs that grow unboundedly (e.g. Q-A memory):

```jsonc
{ "trigger": "every:turn:aki-main",
  "file": ".opencode/reminders/qa-memory-{sessionID}.md",
  "tail_bytes": 8192 }
```

When applied, the injected text is prefixed with
`... [reminders: showing last N bytes of <path>]` so the model knows
content has been truncated from the head. Template substitution happens
*before* the tail slice, so `{sessionID}` / `{agent}` always resolve.

Set globally instead via `maxFileBytes` (head-truncation; coarser),
which caps the file-cache layer at any path.

## Design contract

- **Append-only** to the system prompt (except opt-in `replace` for
  compaction). Composes safely with other plugins.
- **File cache** is mtime+size keyed; mid-session edits to a configured
  file are visible on the next trigger without restarting the session.
- **No new core hooks.** Rides existing `tool.execute.before|after`,
  `experimental.chat.system.transform`,
  `experimental.session.compacting`, plus `chat.message` (for the
  sessionID→agent side-channel).
- **Single named export contract.** The plugin loader iterates
  `Object.values(mod)` and treats every non-function export as a fatal
  error. Do not add `export const ...` for any non-function value.

## Status / next steps

- [x] Step 1: package skeleton, config schema, rule matcher, file cache,
      pending-injection queue
- [x] Step 6: wire the four hooks in `src/index.ts`
- [x] Template tokens (`{sessionID}`, `{agent}`)
- [ ] Step 9: tests (`test/rule-matcher.test.ts`,
      `test/pending-injection.test.ts`, `test/integration.test.ts`)
- [ ] v1.1: `emit_event` tool + `on:event:<name>` trigger
