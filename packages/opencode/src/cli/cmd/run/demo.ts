// Demo mode for testing direct interactive mode without a real SDK.
//
// Enabled with `--demo`. Intercepts prompt submissions and generates synthetic
// SDK events that feed through the real reducer and footer pipeline. This
// lets you test scrollback formatting, permission UI, question UI, and tool
// snapshots without making actual model calls. Pass a demo slash command as
// the initial interactive message to trigger a preview immediately.
//
// Slash commands:
//   /permission [kind] → triggers a permission request variant
//   /question [kind]   → triggers a question request variant
//   /fmt <kind>   → emits a specific tool/text type (text, reasoning, bash,
//                   write, edit, patch, task, todo, question, error, mix)
//
// Demo mode also handles permission and question replies locally, completing
// or failing the synthetic tool parts as appropriate.
import path from "path"
import type { Event, ToolPart } from "@opencode-ai/sdk/v2"
import { createSessionData, reduceSessionData, type SessionData } from "./session-data"
import { writeSessionOutput } from "./stream"
import type { FooterApi, PermissionReply, QuestionReject, QuestionReply, RunPrompt, StreamCommit } from "./types"

const KINDS = [
  "markdown",
  "table",
  "text",
  "reasoning",
  "bash",
  "write",
  "edit",
  "patch",
  "task",
  "todo",
  "question",
  "error",
  "mix",
]
const PERMISSIONS = ["edit", "bash", "read", "task", "external", "doom"] as const
const QUESTIONS = ["multi", "single", "checklist", "custom"] as const

type PermissionKind = (typeof PERMISSIONS)[number]
type QuestionKind = (typeof QUESTIONS)[number]

function permissionKind(value: string | undefined): PermissionKind | undefined {
  const next = (value || "edit").toLowerCase()
  return PERMISSIONS.find((item) => item === next)
}

function questionKind(value: string | undefined): QuestionKind | undefined {
  const next = (value || "multi").toLowerCase()
  return QUESTIONS.find((item) => item === next)
}

const SAMPLE_MARKDOWN = [
  "# Direct Mode Demo",
  "",
  "This is a realistic assistant response for direct-mode formatting checks.",
  "It mixes **bold**, _italic_, `inline code`, links, code fences, and tables in one streamed reply.",
  "",
  "## Summary",
  "",
  "- Restored the final markdown flush so the last block is committed on idle.",
  "- Switched markdown scrollback commits back to top-level block boundaries.",
  "- Added footer-level regression coverage for split-footer rendering.",
  "",
  "## Status",
  "",
  "| Area | Before | After | Notes |",
  "| --- | --- | --- | --- |",
  "| Direct mode | Missing final rows | Stable | Final markdown block now flushes on idle |",
  "| Tables | Dropped in streaming mode | Visible | Block-based commits match the working OpenTUI demo |",
  "| Tests | Partial coverage | Broader coverage | Includes a footer-level split render capture |",
  "",
  "> This sample intentionally includes a wide table so you can spot wrapping and commit bugs quickly.",
  "",
  "```ts",
  "const result = { markdown: true, tables: 2, stable: true }",
  "```",
  "",
  "## Files",
  "",
  "| File | Change |",
  "| --- | --- |",
  "| `scrollback.surface.ts` | Align markdown commit logic with the split-footer demo |",
  "| `footer.ts` | Keep active surfaces across footer-height-only resizes |",
  "| `footer.test.ts` | Capture real split-footer markdown payloads during idle completion |",
  "",
  "Next step: run `/fmt table` if you want a tighter table-only sample.",
].join("\n")

const SAMPLE_TABLE = [
  "# Table Sample",
  "",
  "| Kind | Example | Notes |",
  "| --- | --- | --- |",
  "| Pipe | `A\\|B` | Escaped pipes should stay in one cell |",
  "| Unicode | `漢字` | Wide characters should remain aligned |",
  "| Wrap | `LongTokenWithoutNaturalBreaks_1234567890` | Useful for width stress |",
  "| Status | done | Final row should still appear after idle |",
].join("\n")

type Ref = {
  msg: string
  part: string
  call: string
  tool: string
  input: Record<string, unknown>
  start: number
}

type Ask = {
  ref: Ref
}

type Perm = {
  ref: Ref
  done: {
    title: string
    output: string
    metadata?: Record<string, unknown>
  }
}

type Permit = {
  ref: Ref
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always: string[]
  done: Perm["done"]
}

type State = {
  id: string
  thinking: boolean
  data: SessionData
  footer: FooterApi
  limits: () => Record<string, number>
  msg: number
  part: number
  call: number
  perm: number
  ask: number
  perms: Map<string, Perm>
  asks: Map<string, Ask>
}

type Input = {
  sessionID: string
  thinking: boolean
  limits: () => Record<string, number>
  footer: FooterApi
}

function note(footer: FooterApi, text: string): void {
  footer.append({
    kind: "system",
    text,
    phase: "start",
    source: "system",
  })
}

function clearSubagent(footer: FooterApi): void {
  footer.event({
    type: "stream.subagent",
    state: {
      tabs: [],
      details: {},
      permissions: [],
      questions: [],
    },
  })
}

function showSubagent(
  state: State,
  input: {
    sessionID: string
    partID: string
    callID: string
    label: string
    description: string
    status: "running" | "completed" | "cancelled" | "error"
    title?: string
    toolCalls?: number
    commits: StreamCommit[]
  },
) {
  state.footer.event({
    type: "stream.subagent",
    state: {
      tabs: [
        {
          sessionID: input.sessionID,
          partID: input.partID,
          callID: input.callID,
          label: input.label,
          description: input.description,
          status: input.status,
          title: input.title,
          toolCalls: input.toolCalls,
          lastUpdatedAt: Date.now(),
        },
      ],
      details: {
        [input.sessionID]: {
          sessionID: input.sessionID,
          commits: input.commits,
        },
      },
      permissions: [],
      questions: [],
    },
  })
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms)
      return
    }

    if (signal.aborted) {
      resolve()
      return
    }

    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", done)
      resolve()
    }, ms)

    signal.addEventListener("abort", done, { once: true })
  })
}

function split(text: string): string[] {
  if (text.length <= 48) {
    return [text]
  }

  const size = Math.ceil(text.length / 3)
  return [text.slice(0, size), text.slice(size, size * 2), text.slice(size * 2)]
}

function take(state: State, key: "msg" | "part" | "call" | "perm" | "ask", prefix: string): string {
  state[key] += 1
  return `demo_${prefix}_${state[key]}`
}

function feed(state: State, event: Event): void {
  const out = reduceSessionData({
    data: state.data,
    event,
    sessionID: state.id,
    thinking: state.thinking,
    limits: state.limits(),
  })
  state.data = out.data
  writeSessionOutput(
    {
      footer: state.footer,
    },
    out,
  )
}

function open(state: State): string {
  const id = take(state, "msg", "msg")
  feed(state, {
    type: "message.updated",
    properties: {
      sessionID: state.id,
      info: {
        id,
        sessionID: state.id,
        role: "assistant",
        time: {
          created: Date.now(),
        },
        parentID: `user_${id}`,
        modelID: "demo",
        providerID: "demo",
        mode: "demo",
        agent: "demo",
        path: {
          cwd: process.cwd(),
          root: process.cwd(),
        },
        cost: 0.001,
        tokens: {
          input: 120,
          output: 320,
          reasoning: 80,
          cache: {
            read: 0,
            write: 0,
          },
        },
      },
    },
  } as Event)
  return id
}

async function emitText(state: State, body: string, signal?: AbortSignal): Promise<void> {
  const msg = open(state)
  const part = take(state, "part", "part")
  const start = Date.now()

  feed(state, {
    type: "message.part.updated",
    properties: {
      sessionID: state.id,
      time: Date.now(),
      part: {
        id: part,
        sessionID: state.id,
        messageID: msg,
        type: "text",
        text: "",
        time: {
          start,
        },
      },
    },
  } as Event)

  let next = ""
  for (const item of split(body)) {
    if (signal?.aborted) {
      return
    }

    next += item
    feed(state, {
      type: "message.part.delta",
      properties: {
        sessionID: state.id,
        messageID: msg,
        partID: part,
        field: "text",
        delta: item,
      },
    } as Event)
    await wait(45, signal)
  }

  feed(state, {
    type: "message.part.updated",
    properties: {
      sessionID: state.id,
      time: Date.now(),
      part: {
        id: part,
        sessionID: state.id,
        messageID: msg,
        type: "text",
        text: next,
        time: {
          start,
          end: Date.now(),
        },
      },
    },
  } as Event)
}

async function emitReasoning(state: State, body: string, signal?: AbortSignal): Promise<void> {
  const msg = open(state)
  const part = take(state, "part", "part")
  const start = Date.now()

  feed(state, {
    type: "message.part.updated",
    properties: {
      sessionID: state.id,
      time: Date.now(),
      part: {
        id: part,
        sessionID: state.id,
        messageID: msg,
        type: "reasoning",
        text: "",
        time: {
          start,
        },
      },
    },
  } as Event)

  let next = ""
  for (const item of split(body)) {
    if (signal?.aborted) {
      return
    }

    next += item
    feed(state, {
      type: "message.part.delta",
      properties: {
        sessionID: state.id,
        messageID: msg,
        partID: part,
        field: "text",
        delta: item,
      },
    } as Event)
    await wait(45, signal)
  }

  feed(state, {
    type: "message.part.updated",
    properties: {
      sessionID: state.id,
      time: Date.now(),
      part: {
        id: part,
        sessionID: state.id,
        messageID: msg,
        type: "reasoning",
        text: next,
        time: {
          start,
          end: Date.now(),
        },
      },
    },
  } as Event)
}

function make(state: State, tool: string, input: Record<string, unknown>): Ref {
  return {
    msg: open(state),
    part: take(state, "part", "part"),
    call: take(state, "call", "call"),
    tool,
    input,
    start: Date.now(),
  }
}

function startTool(state: State, ref: Ref, metadata: Record<string, unknown> = {}): void {
  feed(state, {
    type: "message.part.updated",
    properties: {
      sessionID: state.id,
      time: Date.now(),
      part: {
        id: ref.part,
        sessionID: state.id,
        messageID: ref.msg,
        type: "tool",
        callID: ref.call,
        tool: ref.tool,
        state: {
          status: "running",
          input: ref.input,
          metadata,
          time: {
            start: ref.start,
          },
        },
      },
    },
  } as Event)
}

function askPermission(state: State, item: Permit): void {
  startTool(state, item.ref)

  const id = take(state, "perm", "perm")
  state.perms.set(id, {
    ref: item.ref,
    done: item.done,
  })

  feed(state, {
    type: "permission.asked",
    properties: {
      id,
      sessionID: state.id,
      permission: item.permission,
      patterns: item.patterns,
      metadata: item.metadata ?? {},
      always: item.always,
      tool: {
        messageID: item.ref.msg,
        callID: item.ref.call,
      },
    },
  } as Event)
}

function doneTool(
  state: State,
  ref: Ref,
  output: {
    title: string
    output: string
    metadata?: Record<string, unknown>
  },
): void {
  feed(state, {
    type: "message.part.updated",
    properties: {
      sessionID: state.id,
      time: Date.now(),
      part: {
        id: ref.part,
        sessionID: state.id,
        messageID: ref.msg,
        type: "tool",
        callID: ref.call,
        tool: ref.tool,
        state: {
          status: "completed",
          input: ref.input,
          output: output.output,
          title: output.title,
          metadata: output.metadata ?? {},
          time: {
            start: ref.start,
            end: Date.now(),
          },
        },
      },
    },
  } as Event)
}

function failTool(state: State, ref: Ref, error: string): void {
  feed(state, {
    type: "message.part.updated",
    properties: {
      sessionID: state.id,
      time: Date.now(),
      part: {
        id: ref.part,
        sessionID: state.id,
        messageID: ref.msg,
        type: "tool",
        callID: ref.call,
        tool: ref.tool,
        state: {
          status: "error",
          input: ref.input,
          error,
          metadata: {},
          time: {
            start: ref.start,
            end: Date.now(),
          },
        },
      },
    },
  } as Event)
}

function emitError(state: State, text: string): void {
  const event = {
    id: `session.error:${state.id}:${Date.now()}`,
    type: "session.error",
    properties: {
      sessionID: state.id,
      error: {
        name: "UnknownError",
        data: {
          message: text,
        },
      },
    },
  } satisfies Event
  feed(state, event)
}

async function emitBash(state: State, signal?: AbortSignal): Promise<void> {
  const ref = make(state, "bash", {
    command: "git status",
    workdir: process.cwd(),
    description: "Show git status",
  })
  startTool(state, ref)
  await wait(70, signal)
  doneTool(state, ref, {
    title: "git status",
    output: `${process.cwd()}\ngit status\nOn branch demo\nnothing to commit, working tree clean\n`,
    metadata: {
      exitCode: 0,
    },
  })
}

function emitWrite(state: State): void {
  const file = path.join(process.cwd(), "src", "demo-format.ts")
  const ref = make(state, "write", {
    filePath: file,
    content: "export const demo = 42\n",
  })
  doneTool(state, ref, {
    title: "write",
    output: "",
    metadata: {},
  })
}

function emitEdit(state: State): void {
  const file = path.join(process.cwd(), "src", "demo-format.ts")
  const ref = make(state, "edit", {
    filePath: file,
  })
  doneTool(state, ref, {
    title: "edit",
    output: "",
    metadata: {
      diff: "@@ -1 +1 @@\n-export const demo = 1\n+export const demo = 42\n",
    },
  })
}

function emitPatch(state: State): void {
  const file = path.join(process.cwd(), "src", "demo-format.ts")
  const ref = make(state, "apply_patch", {
    patchText: "*** Begin Patch\n*** End Patch",
  })
  doneTool(state, ref, {
    title: "apply_patch",
    output: "",
    metadata: {
      files: [
        {
          type: "update",
          filePath: file,
          relativePath: "src/demo-format.ts",
          diff: "@@ -1 +1 @@\n-export const demo = 1\n+export const demo = 42\n",
          deletions: 1,
        },
        {
          type: "add",
          filePath: path.join(process.cwd(), "README-demo.md"),
          relativePath: "README-demo.md",
          diff: "@@ -0,0 +1,4 @@\n+# Demo\n+This is a generated preview file.\n",
          deletions: 0,
        },
      ],
    },
  })
}

function emitTask(state: State): void {
  const ref = make(state, "task", {
    description: "Scan run/* for reducer touchpoints",
    subagent_type: "explore",
  })
  doneTool(state, ref, {
    title: "Reducer touchpoints found",
    output: "",
    metadata: {
      toolcalls: 4,
      sessionId: "sub_demo_1",
    },
  })
  const part = {
    id: "sub_demo_tool_1",
    type: "tool",
    sessionID: "sub_demo_1",
    messageID: "sub_demo_msg_tool",
    callID: "sub_demo_call_1",
    tool: "read",
    state: {
      status: "running",
      input: {
        filePath: "packages/opencode/src/cli/cmd/run/stream.ts",
        offset: 1,
        limit: 200,
      },
      time: {
        start: Date.now(),
      },
    },
  } satisfies ToolPart
  showSubagent(state, {
    sessionID: "sub_demo_1",
    partID: ref.part,
    callID: ref.call,
    label: "Explore",
    description: "Scan run/* for reducer touchpoints",
    status: "completed",
    title: "Reducer touchpoints found",
    toolCalls: 4,
    commits: [
      {
        kind: "user",
        text: "Scan run/* for reducer touchpoints",
        phase: "start",
        source: "system",
      },
      {
        kind: "reasoning",
        text: "Thinking: tracing reducer and footer boundaries",
        phase: "progress",
        source: "reasoning",
        messageID: "sub_demo_msg_reasoning",
        partID: "sub_demo_reasoning_1",
      },
      {
        kind: "tool",
        text: "running read",
        phase: "start",
        source: "tool",
        messageID: "sub_demo_msg_tool",
        partID: "sub_demo_tool_1",
        tool: "read",
        part,
      },
      {
        kind: "assistant",
        text: "Footer updates flow through stream.ts into RunFooter",
        phase: "progress",
        source: "assistant",
        messageID: "sub_demo_msg_text",
        partID: "sub_demo_text_1",
      },
    ],
  })
}

function emitTodo(state: State): void {
  const ref = make(state, "todowrite", {
    todos: [
      {
        content: "Trigger permission UI",
        status: "completed",
      },
      {
        content: "Trigger question UI",
        status: "in_progress",
      },
      {
        content: "Tune tool formatting",
        status: "pending",
      },
    ],
  })
  doneTool(state, ref, {
    title: "todowrite",
    output: "",
    metadata: {},
  })
}

const BATCH_QUESTION_BATCH = {
  task: "Inspect output style",
  summary: "Confirm which output style and extra rows to show in the demo footer.",
  past: [
    {
      type: "single_select" as const,
      question: "Which output style do you want to inspect?",
      header: "Style",
      intent: "preference" as const,
      options: [
        { id: "diff", label: "Diff", recommended: true, pros: ["Shows edit diff block"] },
        { id: "code", label: "Code", pros: ["Shows code block"] },
      ],
      default: "diff",
    },
  ],
  present: [
    {
      type: "multi_select" as const,
      question: "Pick extra rows to include in the footer preview.",
      header: "Extras",
      intent: "preference" as const,
      options: [
        { id: "usage", label: "Usage", recommended: true, pros: ["Adds usage row"] },
        { id: "duration", label: "Duration", pros: ["Adds duration row"] },
      ],
      default: ["usage"],
    },
  ],
  future: [
    {
      type: "binary_gate" as const,
      question: "Should the demo run with debug logging enabled?",
      header: "Debug mode",
      intent: "alignment" as const,
      consequence: "Additional trace output will be generated",
      default: "no" as const,
    },
  ],
  closing: {
    type: "free_text" as const,
    question: "Any other formatting details you want to test?",
    header: "Additional notes",
    placeholder: "Optional…",
  },
}

function emitQuestionTool(state: State): void {
  const ref = make(state, "question", { batch: BATCH_QUESTION_BATCH })
  doneTool(state, ref, {
    title: "question",
    output: "",
    metadata: {
      answers: [
        { type: "single_select", selection: "diff" },
        { type: "multi_select", selections: ["usage"] },
        { type: "binary_gate", value: false },
        { type: "free_text", value: "" },
      ],
    },
  })
}

const BATCH_QUESTIONS = [
  {
    type: "single_select" as const,
    question: "Which footer view should stay active while testing?",
    header: "Layout",
    intent: "preference" as const,
    options: [
      { id: "prompt", label: "Prompt", recommended: true, pros: ["Return to prompt"] },
      { id: "question", label: "Question", pros: ["Keep question open"] },
    ],
    default: "prompt",
  },
  {
    type: "multi_select" as const,
    question: "Pick formatting previews to emit.",
    header: "Rows",
    intent: "preference" as const,
    options: [
      { id: "diff", label: "Diff", recommended: true, pros: ["Emit edit diff"] },
      { id: "task", label: "Task", pros: ["Emit task card"] },
      { id: "todo", label: "Todo", pros: ["Emit todo card"] },
    ],
    default: ["diff"],
  },
  {
    type: "plan_approval" as const,
    question: "Approve the demo format plan before it runs.",
    header: "Plan",
    intent: "alignment" as const,
    steps: [
      { id: "1", text: "Emit sample markdown" },
      { id: "2", text: "Emit tool outputs (bash/write/edit)" },
      { id: "3", text: "Emit question UI", destructive: false },
    ],
    decisions: ["approve", "edit", "reject"],
    default: "approve",
  },
  {
    type: "free_text" as const,
    question: "Any other formatting details you want to test?",
    header: "Additional notes",
    placeholder: "Optional…",
  },
]

function emitPermission(state: State, kind: PermissionKind = "edit"): void {
  const root = process.cwd()
  const file = path.join(root, "src", "demo-format.ts")

  if (kind === "bash") {
    const command = "git status --short"
    const ref = make(state, "bash", {
      command,
      workdir: root,
      description: "Inspect worktree changes",
    })
    askPermission(state, {
      ref,
      permission: "bash",
      patterns: [command],
      always: ["*"],
      done: {
        title: "git status --short",
        output: `${root}\ngit status --short\n M src/demo-format.ts\n?? src/demo-permission.ts\n`,
        metadata: {
          exitCode: 0,
        },
      },
    })
    return
  }

  if (kind === "read") {
    const target = path.join(root, "package.json")
    const ref = make(state, "read", {
      filePath: target,
      offset: 1,
      limit: 80,
    })
    askPermission(state, {
      ref,
      permission: "read",
      patterns: [target],
      always: [target],
      done: {
        title: "read",
        output: ["1: {", '2:   "name": "opencode",', '3:   "private": true', "4: }"].join("\n"),
        metadata: {},
      },
    })
    return
  }

  if (kind === "task") {
    const ref = make(state, "task", {
      description: "Inspect footer spacing across direct-mode prompts",
      subagent_type: "explore",
    })
    askPermission(state, {
      ref,
      permission: "task",
      patterns: ["explore"],
      always: ["*"],
      done: {
        title: "Footer spacing checked",
        output: "",
        metadata: {
          toolcalls: 3,
          sessionId: "sub_demo_perm_1",
        },
      },
    })
    return
  }

  if (kind === "external") {
    const dir = path.join(path.dirname(root), "demo-shared")
    const target = path.join(dir, "README.md")
    const ref = make(state, "read", {
      filePath: target,
      offset: 1,
      limit: 40,
    })
    askPermission(state, {
      ref,
      permission: "external_directory",
      patterns: [`${dir}/**`],
      metadata: {
        parentDir: dir,
        filepath: target,
      },
      always: [`${dir}/**`],
      done: {
        title: "read",
        output: `1: # External demo\n2: Shared preview file\nPath: ${target}`,
        metadata: {},
      },
    })
    return
  }

  if (kind === "doom") {
    const ref = make(state, "task", {
      description: "Retry the formatter after repeated failures",
      subagent_type: "general",
    })
    askPermission(state, {
      ref,
      permission: "doom_loop",
      patterns: ["*"],
      always: ["*"],
      done: {
        title: "Retry allowed",
        output: "Continuing after repeated failures.\n",
        metadata: {},
      },
    })
    return
  }

  const diff = "@@ -1 +1 @@\n-export const demo = 1\n+export const demo = 42\n"
  const ref = make(state, "edit", {
    filePath: file,
    filepath: file,
    diff,
  })
  askPermission(state, {
    ref,
    permission: "edit",
    patterns: [file],
    always: [file],
    done: {
      title: "edit",
      output: "",
      metadata: {
        diff,
      },
    },
  })
}

function emitQuestion(state: State, kind: QuestionKind = "multi"): void {
  const batch = (() => {
    if (kind === "single") {
      return {
        task: "Footer spacing reference check",
        summary: "Pick which footer view should serve as the spacing reference.",
        present: [
          {
            type: "single_select" as const,
            question: "Which footer should be the reference for spacing checks?",
            header: "Mode",
            intent: "disambiguation" as const,
            options: [
              { id: "permission", label: "Permission", recommended: true, pros: ["Inspect the permission footer"] },
              { id: "question", label: "Question", pros: ["Keep this question footer open"] },
              { id: "prompt", label: "Prompt", pros: ["Return to the normal composer"] },
            ],
            default: "permission",
          },
        ],
        future: [
          { type: "binary_gate" as const, question: "Enable debug?", header: "Debug", default: "no" as const },
        ],
        closing: {
          type: "free_text" as const,
          question: "Anything else to add?",
          header: "Notes",
          placeholder: "Optional…",
        },
      }
    }

    if (kind === "checklist") {
      return {
        task: "Direct-mode case selection",
        summary: "Select the direct-mode cases to inspect next.",
        present: [
          {
            type: "multi_select" as const,
            question: "Select the direct-mode cases you want to inspect next.",
            header: "Checks",
            intent: "preference" as const,
            options: [
              { id: "diff", label: "Diff", recommended: true, pros: ["Show an edit diff in the footer"] },
              { id: "task", label: "Task", pros: ["Show a structured task summary"] },
              { id: "todo", label: "Todo", pros: ["Show a todo snapshot"] },
              { id: "error", label: "Error", pros: ["Show an error transcript row"] },
            ],
            default: ["diff"],
          },
        ],
        future: [
          { type: "binary_gate" as const, question: "Enable debug?", header: "Debug", default: "no" as const },
        ],
        closing: {
          type: "free_text" as const,
          question: "Anything else to add?",
          header: "Notes",
          placeholder: "Optional…",
        },
      }
    }

    if (kind === "custom") {
      return {
        task: "Custom answer preview test",
        summary: "Test custom answer rendering in the question footer.",
        present: [
          {
            type: "editable_default" as const,
            question: "What custom answer should appear in the footer preview?",
            header: "Reply",
            prefill: "Short note",
            used_for: "Footer preview",
          },
        ],
        future: [
          { type: "binary_gate" as const, question: "Enable debug?", header: "Debug", default: "no" as const },
        ],
        closing: {
          type: "free_text" as const,
          question: "Anything else to add?",
          header: "Notes",
          placeholder: "Optional…",
        },
      }
    }

    return {
      task: "Footer view test",
      summary: "Pick the active footer view and formatting previews to run.",
      past: [
        {
          type: "single_select" as const,
          question: "Which footer view should stay active while testing?",
          header: "Layout",
          intent: "preference" as const,
          options: [
            { id: "prompt", label: "Prompt", recommended: true, pros: ["Return to prompt"] },
            { id: "question", label: "Question", pros: ["Keep question open"] },
          ],
          default: "prompt",
        },
      ],
      present: [
        {
          type: "multi_select" as const,
          question: "Pick formatting previews to emit.",
          header: "Rows",
          intent: "preference" as const,
          options: [
            { id: "diff", label: "Diff", recommended: true, pros: ["Emit edit diff"] },
            { id: "task", label: "Task", pros: ["Emit task card"] },
            { id: "todo", label: "Todo", pros: ["Emit todo card"] },
          ],
          default: ["diff"],
        },
      ],
      future: [
        { type: "binary_gate" as const, question: "Enable debug?", header: "Debug", default: "no" as const },
      ],
      closing: {
        type: "free_text" as const,
        question: "Any other formatting details you want to test?",
        header: "Additional notes",
        placeholder: "Optional…",
      },
    }
  })()

  const ref = make(state, "question", { batch })
  startTool(state, ref)

  const id = take(state, "ask", "ask")
  state.asks.set(id, { ref })

  feed(state, {
    type: "question.asked",
    properties: {
      id,
      sessionID: state.id,
      batch,
      tool: {
        messageID: ref.msg,
        callID: ref.call,
      },
    },
  } as Event)
}

async function emitFmt(state: State, kind: string, body: string, signal?: AbortSignal): Promise<boolean> {
  if (kind === "text") {
    await emitText(state, body || SAMPLE_MARKDOWN, signal)
    return true
  }

  if (kind === "markdown" || kind === "md") {
    await emitText(state, body || SAMPLE_MARKDOWN, signal)
    return true
  }

  if (kind === "table") {
    await emitText(state, body || SAMPLE_TABLE, signal)
    return true
  }

  if (kind === "reasoning") {
    await emitReasoning(state, body || "Planning next steps [REDACTED] while preserving reducer ordering.", signal)
    return true
  }

  if (kind === "bash") {
    await emitBash(state, signal)
    return true
  }

  if (kind === "write") {
    emitWrite(state)
    return true
  }

  if (kind === "edit") {
    emitEdit(state)
    return true
  }

  if (kind === "patch") {
    emitPatch(state)
    return true
  }

  if (kind === "task") {
    emitTask(state)
    return true
  }

  if (kind === "todo") {
    emitTodo(state)
    return true
  }

  if (kind === "question") {
    emitQuestionTool(state)
    return true
  }

  if (kind === "error") {
    emitError(state, body || "demo error event")
    return true
  }

  if (kind === "mix") {
    await emitText(state, SAMPLE_MARKDOWN, signal)
    await wait(50, signal)
    await emitReasoning(state, "Thinking through formatter edge cases [REDACTED].", signal)
    await wait(50, signal)
    await emitBash(state, signal)
    emitWrite(state)
    emitEdit(state)
    emitPatch(state)
    emitTask(state)
    emitTodo(state)
    emitQuestionTool(state)
    emitError(state, "demo mixed scenario error")
    return true
  }

  return false
}

function intro(state: State): void {
  note(
    state.footer,
    [
      "Demo slash commands enabled for interactive mode.",
      `- /permission [kind] (${PERMISSIONS.join(", ")})`,
      `- /question [kind] (${QUESTIONS.join(", ")})`,
      `- /fmt <kind> (${KINDS.join(", ")})`,
      "Examples:",
      "- /permission bash",
      "- /question custom",
      "- /fmt markdown",
      "- /fmt table",
      "- /fmt text your custom text",
    ].join("\n"),
  )
}

export function createRunDemo(input: Input) {
  const state: State = {
    id: input.sessionID,
    thinking: input.thinking,
    data: createSessionData(),
    footer: input.footer,
    limits: input.limits,
    msg: 0,
    part: 0,
    call: 0,
    perm: 0,
    ask: 0,
    perms: new Map(),
    asks: new Map(),
  }

  const start = async (): Promise<void> => {
    intro(state)
  }

  const prompt = async (line: RunPrompt, signal?: AbortSignal): Promise<boolean> => {
    const text = line.text.trim()
    const list = text.split(/\s+/)
    const cmd = list[0] || ""

    clearSubagent(state.footer)

    if (cmd === "/help") {
      intro(state)
      return true
    }

    if (cmd === "/permission") {
      const kind = permissionKind(list[1])
      if (!kind) {
        note(state.footer, `Pick a permission kind: ${PERMISSIONS.join(", ")}`)
        return true
      }

      emitPermission(state, kind)
      return true
    }

    if (cmd === "/question") {
      const kind = questionKind(list[1])
      if (!kind) {
        note(state.footer, `Pick a question kind: ${QUESTIONS.join(", ")}`)
        return true
      }

      emitQuestion(state, kind)
      return true
    }

    if (cmd === "/fmt") {
      const kind = (list[1] || "").toLowerCase()
      const body = list.slice(2).join(" ")
      if (!kind) {
        note(state.footer, `Pick a kind: ${KINDS.join(", ")}`)
        return true
      }

      const ok = await emitFmt(state, kind, body, signal)
      if (ok) {
        return true
      }

      note(state.footer, `Unknown kind "${kind}". Use: ${KINDS.join(", ")}`)
      return true
    }

    return false
  }

  const permission = (input: PermissionReply): boolean => {
    const item = state.perms.get(input.requestID)
    if (!item || !input.reply) {
      return false
    }

    state.perms.delete(input.requestID)
    const event = {
      id: `permission.replied:${input.requestID}:${Date.now()}`,
      type: "permission.replied",
      properties: {
        sessionID: state.id,
        requestID: input.requestID,
        reply: input.reply,
      },
    } satisfies Event
    feed(state, event)

    if (input.reply === "reject") {
      failTool(state, item.ref, input.message || "permission rejected")
      return true
    }

    doneTool(state, item.ref, item.done)
    return true
  }

  const questionReply = (input: QuestionReply): boolean => {
    const ask = state.asks.get(input.requestID)
    if (!ask || !input.answers || input.answers.length === 0) {
      return false
    }

    state.asks.delete(input.requestID)
    const event = {
      id: `question.replied:${input.requestID}:${Date.now()}`,
      type: "question.replied",
      properties: {
        sessionID: state.id,
        requestID: input.requestID,
        answers: input.answers,
      },
    } satisfies Event
    feed(state, event)
    doneTool(state, ask.ref, {
      title: "question",
      output: "",
      metadata: {
        answers: input.answers,
      },
    })
    return true
  }

  const questionReject = (input: QuestionReject): boolean => {
    const ask = state.asks.get(input.requestID)
    if (!ask) {
      return false
    }

    state.asks.delete(input.requestID)
    feed(state, {
      type: "question.rejected",
      properties: {
        sessionID: state.id,
        requestID: input.requestID,
      },
    } as Event)
    failTool(state, ask.ref, "question rejected")
    return true
  }

  return {
    start,
    prompt,
    permission,
    questionReply,
    questionReject,
  }
}
