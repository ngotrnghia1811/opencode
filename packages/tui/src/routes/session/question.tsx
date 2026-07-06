import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useRenderer } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { selectedForeground, tint, useTheme } from "../../context/theme"
import type {
  QuestionAnswerItem,
  QuestionItem,
  QuestionRequest,
} from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../ui/border"
import { useTuiConfig } from "../../config"
import { useBindings, useOpencodeModeStack } from "../../keymap"

const QUESTION_MODE = "question"

// ─── Batch flattening ─────────────────────────────────────────────────────────

function flattenBatch(request: QuestionRequest): QuestionItem[] {
  const b = request.batch
  return [...(b.past ?? []), ...(b.present ?? []), ...(b.future ?? []), ...(b.closing ? [b.closing] : [])]
}

function sectionForIndex(batch: QuestionRequest["batch"], index: number): number {
  let offset = 0
  const pastLen = batch.past?.length ?? 0
  if (index < pastLen) return 0
  offset += pastLen
  const presentLen = batch.present?.length ?? 0
  if (index < offset + presentLen) return 1
  offset += presentLen
  const futureLen = batch.future?.length ?? 0
  if (index < offset + futureLen) return 2
  return 3
}

function sectionLabel(sectionIndex: number): string {
  const labels = ["PAST — confirm what I'm building on", "PRESENT — confirm current objective & scope", "FUTURE — lock direction & guardrails", "FINAL — anything I missed?"]
  return labels[sectionIndex] ?? ""
}

// ─── Default seeding ──────────────────────────────────────────────────────────

function emptyAnswer(type: QuestionItem["type"]): QuestionAnswerItem {
  switch (type) {
    case "single_select": return { type: "single_select", selection: "" }
    case "multi_select": return { type: "multi_select", selections: [] }
    case "binary_gate": return { type: "binary_gate", value: false }
    case "disambiguation": return { type: "disambiguation", selection: "" }
    case "ranking": return { type: "ranking", order: [] }
    case "pairwise": return { type: "pairwise", winner: "", no_preference: true }
    case "plan_approval": return { type: "plan_approval", decision: "reject" }
    case "diff_review": return { type: "diff_review", decision: "reject" }
    case "editable_default": return { type: "editable_default", value: "" }
    case "form": return { type: "form", values: {} }
    case "resource_picker": return { type: "resource_picker", selection: "" }
    case "free_text": return { type: "free_text", value: "" }
  }
}

function seedDefault(q: QuestionItem): QuestionAnswerItem {
  const destructive = (q as { destructive?: boolean }).destructive === true
  if (destructive) return emptyAnswer(q.type)

  switch (q.type) {
    case "single_select": {
      const sq = q as { default?: string }
      return sq.default ? { type: "single_select", selection: sq.default } : emptyAnswer(q.type)
    }
    case "multi_select": {
      const mq = q as { default?: string[] }
      return mq.default && mq.default.length > 0
        ? { type: "multi_select", selections: mq.default }
        : emptyAnswer(q.type)
    }
    case "binary_gate": {
      const bq = q as { default?: "yes" | "no" }
      return { type: "binary_gate", value: bq.default === "yes" }
    }
    case "disambiguation": {
      const dq = q as { mode: string; default?: string | string[] }
      if (dq.mode === "single" && typeof dq.default === "string")
        return { type: "disambiguation", selection: dq.default }
      if (dq.mode === "multi" && Array.isArray(dq.default))
        return { type: "disambiguation", selection: dq.default }
      return emptyAnswer(q.type)
    }
    case "ranking": {
      const rq = q as { items: Array<{ id: string; suggested_rank?: number }> }
      return { type: "ranking", order: [...rq.items].sort((a, b) => (a.suggested_rank ?? 999) - (b.suggested_rank ?? 999)).map((i) => i.id) }
    }
    case "pairwise": {
      const pq = q as { default?: string }
      return pq.default ? { type: "pairwise", winner: pq.default, no_preference: false } : emptyAnswer(q.type)
    }
    case "plan_approval": {
      const pq = q as { default?: string }
      const decision = (pq.default ?? "approve") as "approve" | "edit" | "reject"
      return { type: "plan_approval", decision }
    }
    case "diff_review": {
      const dq = q as { default?: string }
      const decision = (dq.default ?? "approve") as "approve" | "request_changes" | "reject"
      return { type: "diff_review", decision }
    }
    case "editable_default": {
      const eq = q as { prefill?: string }
      return { type: "editable_default", value: eq.prefill ?? "" }
    }
    case "form": {
      const fq = q as { fields: Array<{ id: string; default?: string | boolean | number }> }
      const values: Record<string, string | boolean | number> = {}
      for (const f of fq.fields) { if (f.default !== undefined) values[f.id] = f.default }
      return { type: "form", values }
    }
    case "resource_picker": {
      const rq = q as { default?: string }
      return rq.default ? { type: "resource_picker", selection: rq.default } : emptyAnswer(q.type)
    }
    case "free_text":
      return { type: "free_text", value: "" }
  }
}

function answerIsBlank(ans: QuestionAnswerItem): boolean {
  switch (ans.type) {
    case "single_select": return !ans.selection
    case "multi_select": return ans.selections.length === 0
    case "binary_gate": return false
    case "disambiguation": return typeof ans.selection === "string" ? !ans.selection : ans.selection.length === 0
    case "ranking": return ans.order.length === 0
    case "pairwise": return !ans.winner || ans.no_preference === true
    case "plan_approval": return ans.decision === "reject"
    case "diff_review": return ans.decision === "reject"
    case "editable_default": return !ans.value
    case "form": return Object.keys(ans.values).length === 0
    case "resource_picker": return !ans.selection
    case "free_text": return !ans.value
  }
}

// ─── Option counting ──────────────────────────────────────────────────────────

function optionCount(q: QuestionItem): number {
  switch (q.type) {
    case "single_select": return q.options.length
    case "multi_select": return q.options.length
    case "binary_gate": return 2
    case "disambiguation": return q.options.length
    case "ranking": return q.items.length
    case "pairwise": return 2
    case "plan_approval": return q.decisions.length
    case "diff_review": return q.decisions.length
    case "resource_picker": return q.items.length
    case "editable_default": case "form": case "free_text": return 0
  }
}

function hasOtherOption(q: QuestionItem): boolean {
  return q.comment_option !== undefined && q.type !== "free_text" && q.type !== "editable_default" && q.type !== "form"
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function QuestionPrompt(props: { request: QuestionRequest; directory?: string }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const tuiConfig = useTuiConfig()
  const modeStack = useOpencodeModeStack()

  const questions = createMemo(() => flattenBatch(props.request))
  const single = createMemo(() => questions().length === 1)
  const tabs = createMemo(() => (single() ? 1 : questions().length + 1))

  const answers = createMemo(() => questions().map(seedDefault))
  const [store, setStore] = createStore({
    tab: 0,
    answers: questions().map(seedDefault),
    custom: [] as string[],
    selected: 0,
    editing: false,
    submitting: false,
    mode: "build" as "build" | "confirm",
  })

  let textarea: TextareaRenderable | undefined

  const question = createMemo(() => questions()[store.tab])
  const confirmTab = createMemo(() => !single() && store.tab === questions().length)
  const hasComment = createMemo(() => question() ? hasOtherOption(question()!) : false)
  const totalOpts = createMemo(() => {
    const q = question()
    if (!q) return 0
    return optionCount(q) + (hasComment() ? 1 : 0)
  })

  // ─── Answer helpers ───

  const ans = createMemo(() => store.answers[store.tab])
  const isMulti = createMemo(() => {
    const q = question()
    return q?.type === "multi_select" || (q?.type === "disambiguation" && (q as { mode: string }).mode === "multi")
  })

  // ─── Submit / reject ───

  function buildReply(): QuestionAnswerItem[] {
    return store.answers.map((a, i) => a ?? emptyAnswer(questions()[i].type))
  }

  function submit() {
    void sdk.client.question.reply({
      requestID: props.request.id,
      directory: props.directory,
      answers: buildReply(),
    })
  }

  function acceptAll() {
    const all = questions()
    const filled = store.answers.map((existing, i) => {
      const q = all[i]
      if (!q) return existing
      if ((q as { destructive?: boolean }).destructive && answerIsBlank(existing)) return existing
      if (answerIsBlank(existing)) return seedDefault(q)
      return existing
    })
    void sdk.client.question.reply({
      requestID: props.request.id,
      directory: props.directory,
      answers: filled,
    })
  }

  function reject() {
    void sdk.client.question.reject({
      requestID: props.request.id,
      directory: props.directory,
    })
  }

  function setAnswer(answer: QuestionAnswerItem) {
    setStore("answers", store.tab, answer as never)
  }

  // ─── Selection logic ───

  function selectOption(optIndex: number) {
    const q = question()
    if (!q) return

    const opts = optionCount(q)

    // Comment/other selected
    if (hasComment() && optIndex === opts) {
      setStore("editing", true)
      return
    }

    switch (q.type) {
      case "binary_gate": {
        const cur = store.answers[store.tab]
        const curr = cur?.type === "binary_gate" ? cur.value : false
        const next: QuestionAnswerItem = { type: "binary_gate", value: !curr }
        setAnswer(next)
        if (single()) { void sdk.client.question.reply({ requestID: props.request.id, directory: props.directory, answers: buildReply() }); return }
        setStore("tab", store.tab + 1)
        setStore("selected", 0)
        return
      }

      case "multi_select": {
        const selections = "options" in q ? (q.options as Array<{ id: string }>) : []
        const opt = selections[optIndex]
        if (!opt) return
        const cur = store.answers[store.tab]
        const current = cur?.type === "multi_select" ? [...cur.selections] : []
        const idx = current.indexOf(opt.id)
        if (idx === -1) current.push(opt.id)
        else current.splice(idx, 1)
        setAnswer({ type: "multi_select", selections: current })
        return
      }

      case "single_select":
      case "resource_picker": {
        const selections = "options" in q ? (q.options as Array<{ id: string }>) : (q as { items: Array<{ id: string }> }).items
        const opt = selections[optIndex]
        if (!opt) return
        const ansType = q.type === "single_select" ? "single_select" : "resource_picker" as const
        setAnswer({ type: ansType, selection: opt.id } as QuestionAnswerItem)
        if (single()) { void sdk.client.question.reply({ requestID: props.request.id, directory: props.directory, answers: buildReply() }); return }
        setStore("tab", store.tab + 1)
        setStore("selected", 0)
        return
      }

      case "disambiguation": {
        const dq = q as { mode: string; options: Array<{ id: string }> }
        const opt = dq.options[optIndex]
        if (!opt) return
        if (dq.mode === "single") {
          setAnswer({ type: "disambiguation", selection: opt.id })
          if (single()) { void sdk.client.question.reply({ requestID: props.request.id, directory: props.directory, answers: buildReply() }); return }
          setStore("tab", store.tab + 1)
          setStore("selected", 0)
        } else {
          const cur = store.answers[store.tab]
          const sel = cur?.type === "disambiguation" ? (Array.isArray(cur.selection) ? [...cur.selection] : cur.selection ? [cur.selection] : []) : []
          const idx = sel.indexOf(opt.id)
          if (idx === -1) sel.push(opt.id)
          else sel.splice(idx, 1)
          setAnswer({ type: "disambiguation", selection: sel })
        }
        return
      }

      case "pairwise": {
        const pq = q as { option_a: { id: string }; option_b: { id: string } }
        const winner = optIndex === 0 ? pq.option_a.id : pq.option_b.id
        setAnswer({ type: "pairwise", winner, no_preference: false })
        if (single()) { void sdk.client.question.reply({ requestID: props.request.id, directory: props.directory, answers: buildReply() }); return }
        setStore("tab", store.tab + 1)
        setStore("selected", 0)
        return
      }

      case "plan_approval": {
        const pq = q as { decisions: string[] }
        const dec = pq.decisions[optIndex]
        if (!dec) return
        setAnswer({ type: "plan_approval", decision: dec as "approve" | "edit" | "reject" })
        if (single()) { void sdk.client.question.reply({ requestID: props.request.id, directory: props.directory, answers: buildReply() }); return }
        setStore("tab", store.tab + 1)
        setStore("selected", 0)
        return
      }

      case "diff_review": {
        const dq = q as { decisions: string[] }
        const dec = dq.decisions[optIndex]
        if (!dec) return
        setAnswer({ type: "diff_review", decision: dec as "approve" | "request_changes" | "reject" })
        if (single()) { void sdk.client.question.reply({ requestID: props.request.id, directory: props.directory, answers: buildReply() }); return }
        setStore("tab", store.tab + 1)
        setStore("selected", 0)
        return
      }
    }
  }

  function saveCustom() {
    const text = textarea?.plainText?.trim() ?? ""
    const q = question()
    if (!q) { setStore("editing", false); return }

    if (q.type === "editable_default") {
      setAnswer({ type: "editable_default", value: text || (q as { prefill: string }).prefill })
      setStore("editing", false)
      return
    }

    if (q.type === "free_text") {
      setAnswer({ type: "free_text", value: text })
      setStore("editing", false)
      return
    }

    // Comment on other question types
    if (text) {
      const existing = store.answers[store.tab]
      if (existing) {
        setAnswer({ ...existing, comment: text } as QuestionAnswerItem)
      }
    }
    setStore("editing", false)
  }

  // ─── Navigation ───

  function selectTab(index: number) {
    setStore("tab", index)
    setStore("selected", 0)
    setStore("editing", false)
  }

  function moveTo(index: number) {
    setStore("selected", index)
  }

  function moveSelection(dir: -1 | 1) {
    const total = totalOpts()
    if (total <= 0) return
    setStore("selected", (store.selected + dir + total) % total)
  }

  function confirmAction() {
    const total = totalOpts()
    const max = Math.min(total, 9)
    // On confirm tab, enter = submit
    if (confirmTab()) { submit(); return }
    selectOption(store.selected)
  }

  // ─── Ranking reorder ───

  function moveRank(dir: -1 | 1) {
    const q = question()
    if (!q || q.type !== "ranking") return
    const cur = store.answers[store.tab]
    const order = cur?.type === "ranking" ? [...cur.order] : []
    if (order.length === 0) return
    const idx = store.selected
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= order.length) return
    const tmp = order[idx]
    order[idx] = order[newIdx]
    order[newIdx] = tmp
    setAnswer({ type: "ranking", order })
    setStore("selected", newIdx)
  }

  // ─── Lifecycle ───

  onMount(() => {
    const popMode = modeStack.push(QUESTION_MODE)
    onCleanup(popMode)
  })

  // ─── Keybindings: editing mode ───

  useBindings(() => ({
    mode: QUESTION_MODE,
    enabled: store.editing && !confirmTab(),
    commands: [
      {
        name: "prompt.clear", title: "Clear answer edit", category: "Question",
        run() {
          const text = textarea?.plainText ?? ""
          if (!text) { setStore("editing", false); return }
          textarea?.setText("")
        },
      },
    ],
    bindings: [
      { key: "shift+escape", desc: "Cancel answer edit", group: "Question", cmd: () => { setStore("editing", false) } },
      ...tuiConfig.keybinds.get("prompt.clear"),
      { key: "return", desc: "Submit answer edit", group: "Question", cmd: () => { saveCustom() } },
    ],
  }))

  // ─── Keybindings: confirm mode ───

  useBindings(() => ({
    mode: QUESTION_MODE,
    enabled: !store.editing && !store.submitting && (store.mode === "confirm" || confirmTab()),
    commands: [
      { name: "app.exit", title: "Reject question", category: "Question", run: () => { reject() } },
    ],
    bindings: [
      { key: "a", desc: "Accept all & submit", group: "Question", cmd: () => { acceptAll() } },
      { key: "e", desc: "Edit answers", group: "Question", cmd: () => { setStore("mode", "build"); setStore("tab", 0); setStore("selected", 0) } },
      { key: "s", desc: "Skip / reject", group: "Question", cmd: () => { reject() } },
      { key: "escape", desc: "Skip / reject", group: "Question", cmd: () => { reject() } },
      { key: "shift+escape", desc: "Reject question", group: "Question", cmd: () => { reject() } },
      { key: "return", desc: "Submit all", group: "Question", cmd: () => { submit() } },
      ...tuiConfig.keybinds.get("app.exit"),
    ],
  }))

  // ─── Keybindings: build mode ───

  useBindings(() => {
    const total = totalOpts()
    const max = Math.min(total, 9)
    const q = question()

    return {
      mode: QUESTION_MODE,
      enabled: !store.editing && !store.submitting && store.mode === "build" && !confirmTab(),
      commands: [
        { name: "app.exit", title: "Reject question", category: "Question", run: () => { reject() } },
      ],
      bindings: [
        { key: "left", desc: "Previous question", group: "Question", cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()) },
        { key: "h", desc: "Previous question", group: "Question", cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()) },
        { key: "right", desc: "Next question", group: "Question", cmd: () => selectTab((store.tab + 1) % tabs()) },
        { key: "l", desc: "Next question", group: "Question", cmd: () => selectTab((store.tab + 1) % tabs()) },
        { key: "tab", desc: "Next question", group: "Question",
          cmd: ({ event }: { event: { shift: boolean } }) => {
            selectTab((store.tab + (event.shift ? -1 : 1) + tabs()) % tabs())
          },
        },
        ...(q?.type === "ranking"
          ? [
              { key: "K", desc: "Move item up", group: "Question", cmd: () => { moveRank(-1) } },
              { key: "J", desc: "Move item down", group: "Question", cmd: () => { moveRank(1) } },
            ]
          : []),
        ...Array.from({ length: max }, (_, i) => ({
          key: String(i + 1),
          desc: `Select answer ${i + 1}`,
          group: "Question",
          cmd: () => { moveTo(i); selectOption(i) },
        })),
        { key: "up", desc: "Previous answer", group: "Question", cmd: () => moveSelection(-1) },
        { key: "k", desc: "Previous answer", group: "Question", cmd: () => moveSelection(-1) },
        { key: "down", desc: "Next answer", group: "Question", cmd: () => moveSelection(1) },
        { key: "j", desc: "Next answer", group: "Question", cmd: () => moveSelection(1) },
        { key: "return", desc: "Select answer", group: "Question", cmd: () => confirmAction() },
        { key: " ", desc: "Select answer", group: "Question", cmd: () => confirmAction() },
        { key: "escape", desc: "Review / confirm", group: "Question",
          cmd: () => {
            if (!single()) setStore("mode", "confirm")
            else reject()
          },
        },
        { key: "shift+escape", desc: "Reject question", group: "Question", cmd: () => { reject() } },
        ...tuiConfig.keybinds.get("app.exit"),
      ],
    }
  })

  // ─── Render ───

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        {/* Task header */}
        <box paddingLeft={1} paddingBottom={1} flexShrink={0}>
          <text fg={theme.text}>{props.request.batch.task}</text>
          <text fg={theme.textMuted}>{props.request.batch.summary}</text>
        </box>

        {/* Tab bar */}
        <Show when={!single()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <For each={questions()}>
              {(_, index) => {
                const isActive = () => index() === store.tab
                const isAnswered = () => !answerIsBlank(store.answers[index()])
                return (
                  <box
                    paddingLeft={1} paddingRight={1}
                    backgroundColor={isActive() ? theme.accent : theme.backgroundPanel}
                    onMouseUp={() => { if (renderer.getSelection()?.getSelectedText()) return; selectTab(index()) }}
                  >
                    <text fg={
                      isActive() ? selectedForeground(theme, theme.accent)
                        : isAnswered() ? theme.text
                        : theme.textMuted
                    }>
                      {index() + 1}
                    </text>
                  </box>
                )
              }}
            </For>
            <box
              paddingLeft={1} paddingRight={1}
              backgroundColor={confirmTab() ? theme.accent : theme.backgroundPanel}
              onMouseUp={() => { if (renderer.getSelection()?.getSelectedText()) return; selectTab(questions().length) }}
            >
              <text fg={confirmTab() ? selectedForeground(theme, theme.accent) : theme.textMuted}>✓</text>
            </box>
          </box>
        </Show>

        {/* Build mode: render current question by type */}
        <Show when={store.mode === "build" && !confirmTab()}
          fallback={
            <Show when={confirmTab() || store.mode === "confirm"}>
              <ConfirmScreen
                questions={questions()}
                answers={store.answers.map((a, i) => a ?? emptyAnswer(questions()[i].type))}
                theme={theme}
              />
            </Show>
          }
        >
          {/* Section header */}
          <Show when={sectionForIndex(props.request.batch, store.tab) !== (store.tab > 0 ? sectionForIndex(props.request.batch, store.tab - 1) : -1)}>
            <box paddingLeft={1} paddingTop={1}>
              <text fg={theme.accent}>═══ {sectionLabel(sectionForIndex(props.request.batch, store.tab))} ═══</text>
            </box>
          </Show>

          <box paddingLeft={1} gap={1}>
            {/* Question text */}
            <box>
              <text fg={theme.text}>{question()?.question}</text>
            </box>

            {/* Per-type rendering */}
            <box>
              <Show when={question()}>{q => <QuestionRenderer
                question={q()!}
                ans={ans()}
                selected={store.selected}
                active={true}
                theme={theme}
                renderer={renderer}
                textarea={textarea}
                onMark={(i) => moveTo(i)}
                onChoose={(i) => confirmAction()}
                onStartEdit={() => setStore("editing", true)}
              />}</Show>
            </box>
          </box>
        </Show>

        {/* Editing textarea (rendered outside the per-type renderer for free_text/editable_default) */}
        <Show when={question() && store.editing && !confirmTab() && store.mode === "build"}>
          {(() => {
            const q = question()!
            const inputText = store.custom[store.tab] ?? (
              q.type === "editable_default" ? (q as { prefill: string }).prefill
                : q.type === "free_text" ? ""
                : ""
            )
            return (
              <box paddingLeft={3}>
                <textarea
                  ref={(val: TextareaRenderable) => {
                    textarea = val
                    val.traits = { status: "ANSWER" }
                    queueMicrotask(() => { val.focus(); val.gotoLineEnd() })
                  }}
                  initialValue={inputText}
                  placeholder={
                    q.type === "free_text" ? ((q as { placeholder?: string }).placeholder ?? "Type your answer")
                    : "Type your answer"
                  }
                  placeholderColor={theme.textMuted}
                  minHeight={1}
                  maxHeight={6}
                  textColor={theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.primary}
                />
              </box>
            )
          })()}
        </Show>

        {/* Editing textarea for "Other / comment" */}
        <Show when={store.editing && !confirmTab() && store.mode === "build"}>
          {(() => {
            const q = question()
            if (!q || q.type === "editable_default" || q.type === "free_text") return null
            return (
              <box paddingLeft={3}>
                <textarea
                  ref={(val: TextareaRenderable) => {
                    textarea = val
                    val.traits = { status: "ANSWER" }
                    queueMicrotask(() => { val.focus(); val.gotoLineEnd() })
                  }}
                  initialValue={store.custom[store.tab] ?? ""}
                  placeholder="Add your comment / context..."
                  placeholderColor={theme.textMuted}
                  minHeight={1}
                  maxHeight={6}
                  textColor={theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.primary}
                />
              </box>
            )
          })()}
        </Show>
      </box>

      {/* Footer keybinding hints */}
      <box
        flexDirection="row" flexShrink={0} gap={1}
        paddingLeft={2} paddingRight={3} paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <Show when={!store.editing}>
            <Show when={!single()}>
              <Show when={!confirmTab()}>
                <text fg={theme.text}>{"⇆"} <span style={{ fg: theme.textMuted }}>tab</span></text>
              </Show>
            </Show>
            <Show when={!confirmTab()}>
              <text fg={theme.text}>{"↑↓"} <span style={{ fg: theme.textMuted }}>select</span></text>
            </Show>
            <Show when={confirmTab() || store.mode === "confirm"}>
              <text fg={theme.text}>[A] <span style={{ fg: theme.textMuted }}>accept all</span></text>
              <text fg={theme.text}>[E] <span style={{ fg: theme.textMuted }}>edit</span></text>
              <text fg={theme.text}>[S] <span style={{ fg: theme.textMuted }}>skip</span></text>
            </Show>
            <Show when={!confirmTab() && store.mode === "build"}>
              <text fg={theme.text}>enter <span style={{ fg: theme.textMuted }}>choose</span></text>
              <text fg={theme.text}>esc <span style={{ fg: theme.textMuted }}>confirm/dismiss</span></text>
            </Show>
          </Show>
          <Show when={store.editing}>
            <text fg={theme.text}>enter <span style={{ fg: theme.textMuted }}>save</span></text>
            <text fg={theme.text}>esc <span style={{ fg: theme.textMuted }}>cancel</span></text>
          </Show>
        </box>
      </box>
    </box>
  )
}

// ─── Confirm screen ───────────────────────────────────────────────────────────

function ConfirmScreen(props: { questions: QuestionItem[]; answers: QuestionAnswerItem[]; theme: ReturnType<typeof useTheme>["theme"] }) {
  return (
    <box flexDirection="column" gap={1} paddingLeft={1}>
      <text fg={props.theme.accent}>[A] accept ALL · [E] edit · [S] skip</text>
      <For each={props.questions}>
        {(q, i) => {
          const ans = props.answers[i()]
          return (
            <box>
              <text>
                <span style={{ fg: props.theme.textMuted }}>{q.header}:</span>{" "}
                <span style={{ fg: answerIsBlank(ans) ? props.theme.error : props.theme.text }}>
                  {confirmLabel(q, ans)}
                </span>
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function confirmLabel(q: QuestionItem, ans: QuestionAnswerItem): string {
  switch (ans.type) {
    case "single_select": return ans.selection || "(not answered)"
    case "multi_select": return ans.selections.length > 0 ? ans.selections.join(", ") : "(none)"
    case "binary_gate": return ans.value ? "Yes" : "No"
    case "disambiguation": return typeof ans.selection === "string" ? ans.selection : ans.selection.join(", ")
    case "ranking": return ans.order.length > 0 ? ans.order.join(" > ") : "(unordered)"
    case "pairwise": return ans.no_preference ? "(no preference)" : ans.winner
    case "plan_approval": return `[${ans.decision[0]}]${ans.decision.slice(1)}`
    case "diff_review": return ans.decision === "request_changes" ? "change request" : `[${ans.decision[0]}]${ans.decision.slice(1)}`
    case "editable_default": return `"${ans.value}"`
    case "form": return Object.values(ans.values).join(", ") || "(empty)"
    case "resource_picker": return ans.selection || "(not selected)"
    case "free_text": return ans.value ? `"${ans.value}"` : "(no answer)"
  }
}

// ─── Per-type question renderer ───────────────────────────────────────────────

function QuestionRenderer(props: {
  question: QuestionItem
  ans: QuestionAnswerItem | undefined
  selected: number
  active: boolean
  theme: ReturnType<typeof useTheme>["theme"]
  renderer: ReturnType<typeof useRenderer>
  textarea: TextareaRenderable | undefined
  onMark: (index: number) => void
  onChoose: (index: number) => void
  onStartEdit: () => void
}) {
  const q = props.question
  const t = props.theme

  const opts = optionCount(q)
  const hasCommentOpt = hasOtherOption(q)

  return (
    <box flexDirection="column" gap={0}>
      <For each={renderOptions(q)}>
        {(opt, i) => (
          <>
            <Show when={i() === 0 && q.type === "ranking"}>
              <box paddingLeft={2} paddingBottom={1}>
                <text fg={t.textMuted}>K/J move item · enter confirms order</text>
              </box>
            </Show>
            <Show when={i() === 0 && q.type === "plan_approval" && "steps" in q}>
              <For each={(q as { steps: Array<{ text: string; destructive?: boolean }> }).steps}>
                {(step, si) => (
                  <box paddingLeft={3}>
                    <text fg={step.destructive ? t.error : t.text}>
                      {step.destructive ? "⚠ " : ""}{si() + 1}. {step.text}
                    </text>
                  </box>
                )}
              </For>
            </Show>
            <Show when={i() === 0 && q.type === "diff_review"}>
              <box paddingLeft={1}>
                <text fg={t.textMuted}>Artifact: {(q as { artifact_ref: string }).artifact_ref}</text>
              </box>
              <Show when={(q as { blast_radius?: string }).blast_radius}>
                <box paddingLeft={1}>
                  <text fg={(q as { blast_radius?: string }).blast_radius === "high" ? t.error : t.textMuted}>
                    Blast radius: {(q as { blast_radius?: string }).blast_radius}
                  </text>
                </box>
              </Show>
            </Show>
            <Show when={i() === 0 && q.type === "editable_default"}>
              <box paddingLeft={1}>
                <text fg={t.textMuted}>Default: {(q as { prefill: string }).prefill}</text>
              </box>
              <Show when={(q as { used_for?: string }).used_for != null}>
                <box paddingLeft={1}>
                  <text fg={t.textMuted}>Used for: {(q as { used_for?: string }).used_for}</text>
                </box>
              </Show>
            </Show>
            <Show when={i() === 0 && q.type === "form"}>
              <For each={(q as { fields: Array<{ id: string; label?: string; default?: unknown }> }).fields}>
                {(field) => {
                  const ans = props.ans
                  const val = ans?.type === "form" ? ans.values[field.id] : undefined
                  return (
                    <box paddingLeft={1} flexDirection="row" gap={1}>
                      <text fg={t.text}>{field.label ?? field.id}:</text>
                      <text fg={val !== undefined ? t.success : t.textMuted}>{val !== undefined ? `${val}` : "(not set)"}</text>
                    </box>
                  )
                }}
              </For>
            </Show>
            <Show when={i() === 0 && q.type === "free_text"}>
              <box paddingLeft={1}>
                <text fg={t.textMuted}>{(q as { placeholder?: string }).placeholder ?? "Enter your response…"}</text>
              </box>
            </Show>

            <OptRow
              i={i()} n={i() + 1}
              label={opt.label} desc={opt.desc ?? ""}
              marker={opt.marker} checkmark={opt.checkmark}
              recommended={opt.recommended}
              destructive={opt.destructive}
              cursor={(idx) => props.active && props.selected === idx}
              theme={t}
              disabled={false}
              onMark={() => props.onMark(i())}
              onChoose={() => {
                if (q.type === "editable_default" || q.type === "free_text" || q.type === "form") {
                  props.onStartEdit()
                  return
                }
                props.onChoose(i())
              }}
            />
          </>
        )}
      </For>

      {/* Comment / Other option */}
      <Show when={hasCommentOpt}>
        <OptRow
          i={opts} n={opts + 1}
          label="✎ Other / comment" desc="Add additional context"
          marker={""} checkmark={false}
          cursor={(idx) => props.active && props.selected === idx}
          theme={t} disabled={false}
          onMark={() => props.onMark(opts)}
          onChoose={() => {
            props.onMark(opts)
            props.onStartEdit()
          }}
        />
      </Show>
    </box>
  )
}

// ─── Option descriptor for per-type rendering ──────────────────────────────────

type OptDescriptor = {
  label: string
  desc?: string
  marker: string
  checkmark: boolean
  recommended?: boolean
  destructive?: boolean
}

function renderOptions(q: QuestionItem): OptDescriptor[] {
  switch (q.type) {
    case "single_select": {
      const sel = q as QuestionItem & { type: "single_select" }
      return sel.options.map((opt) => {
        const picked = false
        return {
          label: opt.label,
          desc: opt.pros?.join("; "),
          marker: picked ? "●" : "○",
          checkmark: picked,
          recommended: opt.recommended,
          destructive: sel.destructive,
        }
      })
    }
    case "multi_select": {
      const sel = q as QuestionItem & { type: "multi_select" }
      return sel.options.map((opt) => {
        return {
          label: opt.label,
          desc: opt.pros?.join("; "),
          marker: `[ ]`,
          checkmark: false,
          recommended: opt.recommended,
          destructive: opt.destructive ?? sel.destructive,
        }
      })
    }
    case "binary_gate": {
      const bq = q as QuestionItem & { type: "binary_gate" }
      return [
        { label: "Yes", desc: bq.consequence ?? "", marker: "○", checkmark: false, recommended: bq.default === "yes" && !bq.destructive, destructive: bq.destructive },
        { label: "No", desc: "", marker: "○", checkmark: false, recommended: bq.default === "no" || bq.destructive === true, destructive: false },
      ]
    }
    case "disambiguation": {
      const dq = q as QuestionItem & { type: "disambiguation" }
      const modeMarker = dq.mode === "single" ? "○" : "[ ]"
      return dq.options.map((opt) => ({
        label: opt.label,
        desc: opt.implies,
        marker: modeMarker,
        checkmark: false,
        recommended: opt.recommended,
      }))
    }
    case "ranking": {
      const rq = q as QuestionItem & { type: "ranking" }
      return rq.items.map((item, i) => ({
        label: `#${i + 1}  ${item.label}`,
        desc: item.suggested_rank !== undefined ? `suggested: #${item.suggested_rank}` : undefined,
        marker: "",
        checkmark: false,
      }))
    }
    case "pairwise": {
      const pq = q as QuestionItem & { type: "pairwise" }
      return [
        { label: `A: ${pq.option_a.sample}`, desc: "", marker: "○", checkmark: false, recommended: pq.default === pq.option_a.id },
        { label: `B: ${pq.option_b.sample}`, desc: "", marker: "○", checkmark: false, recommended: pq.default === pq.option_b.id },
      ]
    }
    case "plan_approval": {
      const pq = q as QuestionItem & { type: "plan_approval" }
      return pq.decisions.map((dec) => {
        const label = `[${dec[0]}]${dec.slice(1)}`
        return { label, desc: "", marker: "○", checkmark: false, recommended: pq.default === dec }
      })
    }
    case "diff_review": {
      const dq = q as QuestionItem & { type: "diff_review" }
      return dq.decisions.map((dec) => {
        const label = dec === "request_changes" ? "[c]hange request" : `[${dec[0]}]${dec.slice(1)}`
        return { label, desc: "", marker: "○", checkmark: false, recommended: dq.default === dec }
      })
    }
    case "resource_picker": {
      const rq = q as QuestionItem & { type: "resource_picker" }
      return rq.items.map((item) => ({
        label: item.label,
        desc: item.meta,
        marker: "○",
        checkmark: false,
        recommended: item.recommended,
      }))
    }
    case "editable_default":
    case "form":
    case "free_text":
      return [] // no numbered options; interaction via textarea or read-only display
  }
}

// ─── Shared option row ────────────────────────────────────────────────────────

function OptRow(props: {
  i: number
  n: number
  label: string
  desc: string
  marker: string
  checkmark: boolean
  recommended?: boolean
  destructive?: boolean
  cursor: (index: number) => boolean
  theme: ReturnType<typeof useTheme>["theme"]
  disabled: boolean
  onMark: () => void
  onChoose: () => void
}) {
  const active = props.cursor(props.i)
  const fg = () =>
    active ? props.theme.accent
    : props.recommended ? props.theme.success
    : props.checkmark ? props.theme.success
    : props.theme.text
  const renderer = useRenderer()

  return (
    <box flexDirection="column" gap={0}
      onMouseOver={() => { if (!props.disabled) props.onMark() }}
      onMouseDown={() => { if (!props.disabled) props.onMark() }}
      onMouseUp={() => { if (renderer.getSelection()?.getSelectedText()) return; props.onChoose() }}
    >
      <box flexDirection="row" gap={1}>
        <box backgroundColor={active ? props.theme.backgroundElement : undefined} paddingRight={1}>
          <text fg={active ? tint(props.theme.textMuted, props.theme.secondary, 0.6) : props.theme.textMuted}>
            {props.n}.
          </text>
        </box>
        <box backgroundColor={active ? props.theme.backgroundElement : undefined}>
          <text fg={fg()}>
            {props.marker ? `${props.marker} ` : ""}{props.label}
            {props.destructive ? " ⚠" : ""}
          </text>
        </box>
      </box>
      <Show when={props.desc}>
        <box paddingLeft={4}><text fg={props.theme.textMuted}>{props.desc}</text></box>
      </Show>
    </box>
  )
}
