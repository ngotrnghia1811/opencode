// Question UI body for the direct-mode footer.
//
// Renders batch questions organized into PAST/PRESENT/FUTURE/CLOSING sections.
// Each question type gets a specialized sub-renderer for its interaction model.
// Supports accept-all/edit/skip at the confirm screen.
//
// All state logic lives in question.shared.ts as a pure state machine.
/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { QuestionRequest, QuestionAnswerItem, QuestionItem, QuestionBatchPrompt } from "@opencode-ai/sdk/v2"
import {
  allQuestions,
  createQuestionBodyState,
  questionAcceptAll,
  questionConfirm,
  questionInfo,
  questionInput,
  questionMove,
  questionMoveRank,
  questionReject,
  questionSave,
  questionSelect,
  questionSetEditing,
  questionSetSelected,
  questionSetSubmitting,
  questionSetTab,
  questionSingle,
  questionStoreCustom,
  questionSubmit,
  questionSync,
  questionTabs,
  questionTotal,
  sectionForIndex,
  sectionLabel,
  type QuestionBodyState,
} from "./question.shared"
import { footerWidthPolicy } from "./footer.width"
import type { RunFooterTheme } from "./theme"
import type { QuestionReject, QuestionReply } from "./types"

type Props = {
  request: QuestionRequest
  theme: RunFooterTheme
  onReply: (input: QuestionReply) => void | Promise<void>
  onReject: (input: QuestionReject) => void | Promise<void>
}

export function RunQuestionBody(props: Props) {
  const dims = useTerminalDimensions()
  const batch = () => props.request.batch
  const [state, setState] = createSignal(
    createQuestionBodyState(props.request.id, batch()),
  )
  const single = createMemo(() => questionSingle(batch()))
  const confirm = createMemo(() => questionConfirm(batch(), state()))
  const disabled = createMemo(() => state().submitting)
  const narrow = createMemo(() => footerWidthPolicy(dims().width).dialog.narrow)
  let area: TextareaRenderable | undefined

  createEffect(() => {
    setState((prev) => questionSync(prev, props.request.id, batch()))
  })

  const setTab = (tab: number) => setState((prev) => questionSetTab(prev, tab))
  const move = (dir: -1 | 1) => setState((prev) => questionMove(prev, batch(), dir))

  const beginReply = async (input: QuestionReply) => {
    setState((prev) => questionSetSubmitting(prev, true))
    try { await props.onReply(input) } catch {
      setState((prev) => questionSetSubmitting(prev, false))
    }
  }

  const beginReject = async (input: QuestionReject) => {
    setState((prev) => questionSetSubmitting(prev, true))
    try { await props.onReject(input) } catch {
      setState((prev) => questionSetSubmitting(prev, false))
    }
  }

  const saveCustom = () => {
    const cur = state()
    const next = questionSave(cur, batch())
    if (next.state !== cur) setState(next.state)
    if (!next.reply) return
    void beginReply(next.reply)
  }

  const choose = (selected: number) => {
    const base = state()
    const cur = questionSetSelected(base, selected)
    const next = questionSelect(cur, batch())
    if (next.state !== base) setState(next.state)
    if (!next.reply) return
    void beginReply(next.reply)
  }

  const mark = (selected: number) => setState((prev) => questionSetSelected(prev, selected))
  const select = () => {
    const cur = state()
    const next = questionSelect(cur, batch())
    if (next.state !== cur) setState(next.state)
    if (!next.reply) return
    void beginReply(next.reply)
  }

  const submit = () => void beginReply(questionSubmit(batch(), state()))
  const acceptAll = () => void beginReply(questionAcceptAll(batch(), state()))
  const reject = () => void beginReject(questionReject(props.request))

  useKeyboard((event) => {
    const cur = state()
    if (cur.submitting) { event.preventDefault(); return }

    if (cur.editing) {
      if (event.name === "escape") {
        setState((prev) => questionSetEditing(prev, false))
        event.preventDefault()
      }
      return
    }

    if (cur.mode === "confirm") {
      if (event.name === "a") { acceptAll(); event.preventDefault(); return }
      if (event.name === "e") { setState((prev) => ({ ...prev, mode: "build" })); event.preventDefault(); return }
      if (event.name === "s" || event.name === "escape") { reject(); event.preventDefault(); return }
      if (event.name === "return") { submit(); event.preventDefault(); return }
      return
    }

    if (!single() && (event.name === "left" || event.name === "h")) {
      setTab((cur.tab - 1 + questionTabs(batch())) % questionTabs(batch()))
      event.preventDefault()
      return
    }

    if (!single() && (event.name === "right" || event.name === "l")) {
      setTab((cur.tab + 1) % questionTabs(batch()))
      event.preventDefault()
      return
    }

    if (!single() && event.name === "tab") {
      const dir = event.shift ? -1 : 1
      setTab((cur.tab + dir + questionTabs(batch())) % questionTabs(batch()))
      event.preventDefault()
      return
    }

    if (event.name === "escape") {
      if (!single()) setState((prev) => ({ ...prev, mode: "confirm" }))
      else reject()
      event.preventDefault()
      return
    }

    if (questionConfirm(batch(), cur)) {
      if (event.name === "return") { submit(); event.preventDefault(); return }
      if (event.name === "escape") { reject(); event.preventDefault(); return }
      return
    }

    const total = questionTotal(batch(), cur)
    const max = Math.min(total, 9)
    const digit = Number(event.name)
    if (!Number.isNaN(digit) && digit >= 1 && digit <= max) {
      choose(digit - 1)
      event.preventDefault()
      return
    }

    if (event.name === "up" || event.name === "k") { move(-1); event.preventDefault(); return }
    if (event.name === "down" || event.name === "j") { move(1); event.preventDefault(); return }

    const q = questionInfo(batch(), cur)
    if (q && q.type === "ranking") {
      if (event.name === "K") { setState((prev) => questionMoveRank(prev, batch(), -1)); event.preventDefault(); return }
      if (event.name === "J") { setState((prev) => questionMoveRank(prev, batch(), 1)); event.preventDefault(); return }
    }

    if (event.name === "return") { select(); event.preventDefault(); return }
    if (event.name === " ") { select(); event.preventDefault() }
  })

  createEffect(() => {
    if (!state().editing || !area || area.isDestroyed) return
    if (area.plainText !== questionInput(state())) {
      area.setText(questionInput(state()))
      area.cursorOffset = questionInput(state()).length
    }
    queueMicrotask(() => {
      if (!area || area.isDestroyed || !state().editing) return
      area.focus()
      area.cursorOffset = area.plainText.length
    })
  })

  const questions = () => allQuestions(batch())

  return (
    <box width="100%" height="100%" flexDirection="column">
      <box
        flexDirection="column" gap={1}
        paddingLeft={1} paddingRight={3} paddingTop={1}
        flexGrow={1} flexShrink={1}
        backgroundColor={props.theme.surface}
      >
        <box paddingLeft={1} paddingBottom={1} flexShrink={0}>
          <text fg={props.theme.text} wrapMode="word">{batch().task}</text>
          <text fg={props.theme.muted} wrapMode="word">{batch().summary}</text>
        </box>

        <Show when={!single()}>
          <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
            <For each={questions()}>
              {(_, index) => {
                const active = () => state().tab === index()
                const hasAns = () => {
                  const a = state().answers[index()]
                  return a ? !answerIsBlank(a) : false
                }
                return (
                  <box
                    paddingLeft={1} paddingRight={1}
                    backgroundColor={active() ? props.theme.highlight : props.theme.surface}
                    onMouseUp={() => { if (!disabled()) setTab(index()) }}
                  >
                    <text fg={active() ? props.theme.surface : hasAns() ? props.theme.text : props.theme.muted}>
                      {index() + 1}
                    </text>
                  </box>
                )
              }}
            </For>
            <box
              paddingLeft={1} paddingRight={1}
              backgroundColor={confirm() ? props.theme.highlight : props.theme.surface}
              onMouseUp={() => { if (!disabled()) setTab(questions().length) }}
            >
              <text fg={confirm() ? props.theme.surface : props.theme.muted}>✓</text>
            </box>
          </box>
        </Show>

        <Show
          when={state().mode !== "confirm" && !confirm()}
          fallback={<ConfirmScreen state={state()} batch={batch()} theme={props.theme} />}
        >
          <box width="100%" flexGrow={1} flexShrink={1} paddingLeft={1}>
            <scrollbox
              width="100%" height="100%"
              verticalScrollbarOptions={{
                trackOptions: { backgroundColor: props.theme.surface, foregroundColor: props.theme.line },
              }}
            >
              <box width="100%" flexDirection="column" gap={1}>
                <For each={questions()}>
                  {(question, index) => (
                    <>
                      <Show when={index() === 0 || sectionForIndex(batch(), index()) !== sectionForIndex(batch(), index() - 1)}>
                        <box flexDirection="row" gap={1} paddingTop={index() > 0 ? 1 : 0}>
                          <text fg={props.theme.warning}>
                            ═══ {sectionLabel(sectionForIndex(batch(), index()))} ═══
                          </text>
                        </box>
                      </Show>
                      <QuestionView
                        question={question}
                        active={state().tab === index()}
                        state={state()}
                        batch={batch()}
                        theme={props.theme}
                        disabled={disabled()}
                        onMark={mark}
                        onChoose={choose}
                        areaVar={area}
                        setState={setState}
                        saveCustom={saveCustom}
                      />
                    </>
                  )}
                </For>
              </box>
            </scrollbox>
          </box>
        </Show>
      </box>

      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0} gap={1}
        paddingLeft={2} paddingRight={3} paddingBottom={1}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <Show
          when={!disabled()}
          fallback={
            <text fg={props.theme.muted} wrapMode="word">Waiting for question event...</text>
          }
        >
          <box flexDirection={narrow() ? "column" : "row"} gap={narrow() ? 1 : 2} flexShrink={0} width={narrow() ? "100%" : undefined}>
            <Show
              when={!state().editing}
              fallback={
                <>
                  <text fg={props.theme.text}>enter <span style={{ fg: props.theme.muted }}>save</span></text>
                  <text fg={props.theme.text}>esc <span style={{ fg: props.theme.muted }}>cancel</span></text>
                </>
              }
            >
              <Show when={!single()}>
                <text fg={props.theme.text}>{"⇆"} <span style={{ fg: props.theme.muted }}>tab</span></text>
              </Show>
              <Show when={!confirm()}>
                <text fg={props.theme.text}>{"↑↓"} <span style={{ fg: props.theme.muted }}>select</span></text>
              </Show>
              <text fg={props.theme.text}>enter <span style={{ fg: props.theme.muted }}>choose</span></text>
              <text fg={props.theme.text}>esc <span style={{ fg: props.theme.muted }}>confirm/dismiss</span></text>
            </Show>
          </box>
        </Show>
      </box>
    </box>
  )
}

// ─── Confirm screen ───────────────────────────────────────────────────────────

function ConfirmScreen(props: {
  state: { answers: QuestionAnswerItem[] }
  batch: QuestionBatchPrompt
  theme: RunFooterTheme
}) {
  const qs = () => allQuestions(props.batch)
  return (
    <box width="100%" flexGrow={1} flexShrink={1} paddingLeft={1}>
      <scrollbox
        width="100%" height="100%"
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: props.theme.surface, foregroundColor: props.theme.line },
        }}
      >
        <box paddingLeft={1} paddingBottom={1}>
          <text fg={props.theme.highlight}>[A] accept ALL · [E] edit · [S] skip</text>
        </box>
        <For each={qs()}>
          {(q, i) => {
            const ans = props.state.answers[i()]!
            return (
              <box paddingLeft={1}>
                <text wrapMode="word">
                  <span style={{ fg: props.theme.muted }}>{q.header}:</span>{" "}
                  <span style={{ fg: props.theme.text }}>{answerLabel(q, ans)}</span>
                </text>
              </box>
            )
          }}
        </For>
      </scrollbox>
    </box>
  )
}

function answerLabel(_q: QuestionItem, ans: QuestionAnswerItem): string {
  switch (ans.type) {
    case "single_select": return ans.selection || "(not answered)"
    case "multi_select": return ans.selections.length > 0 ? ans.selections.join(", ") : "(none)"
    case "binary_gate": return ans.value ? "Yes" : "No"
    case "disambiguation": return typeof ans.selection === "string" ? ans.selection : ans.selection.join(", ")
    case "ranking": return ans.order.length > 0 ? ans.order.join(" > ") : "(unordered)"
    case "pairwise": return ans.no_preference ? "(no preference)" : ans.winner
    case "plan_approval": return ans.decision
    case "diff_review": return ans.decision
    case "editable_default": return `"${ans.value}"`
    case "form": return Object.values(ans.values).join(", ") || "(empty)"
    case "resource_picker": return ans.selection || "(not selected)"
    case "free_text": return ans.value ? `"${ans.value}"` : "(no answer)"
  }
}

// ─── Per-type question renderer ───────────────────────────────────────────────

function QuestionView(props: {
  question: QuestionItem
  active: boolean
  state: QuestionBodyState
  batch: QuestionBatchPrompt
  theme: RunFooterTheme
  disabled: boolean
  onMark: (index: number) => void
  onChoose: (index: number) => void
  areaVar: TextareaRenderable | undefined
  setState: (fn: (prev: QuestionBodyState) => QuestionBodyState) => void
  saveCustom: () => void
}) {
  const q = props.question
  const ans = () => props.state.answers[props.state.tab]
  const sel = () => props.state.selected
  const t = props.theme
  const cursor = (index: number) => props.active && sel() === index

  const hasComment = !(q.type === "free_text" || q.type === "editable_default" || q.type === "form") && q.comment_option !== undefined
  const commentIdx = () => questionTotal(props.batch, props.state) - 1

  return (
    <box flexDirection="column" gap={0} paddingLeft={1}>
      <text fg={t.text} wrapMode="word">{q.question}</text>

      {/* single_select */}
      <Show when={q.type === "single_select" && "options" in q}>
        <For each={(q as { options: Array<{ id: string; label: string; pros?: string[]; recommended?: boolean }> }).options}>
          {(opt, i) => {
            const an = ans()
            const selected = an?.type === "single_select" && an.selection === opt.id
            const isDestructive = "destructive" in q && q.destructive === true
            return (
              <OptRow i={i()} n={i() + 1} label={opt.label} desc={opt.pros?.join("; ") ?? ""}
                marker={selected ? "●" : "○"} checkmark={selected}
                recommended={opt.recommended} destructive={isDestructive}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(i())} onChoose={() => props.onChoose(i())} />
            )
          }}
        </For>
      </Show>

      {/* multi_select */}
      <Show when={q.type === "multi_select" && "options" in q}>
        <For each={(q as { options: Array<{ id: string; label: string; pros?: string[]; recommended?: boolean; destructive?: boolean }>; destructive?: boolean }).options}>
          {(opt, i) => {
            const an = ans()
            const checked = an?.type === "multi_select" && an.selections.includes(opt.id)
            return (
              <OptRow i={i()} n={i() + 1} label={opt.label} desc={opt.pros?.join("; ") ?? ""}
                marker={`[${checked ? "✓" : " "}]`} checkmark={checked}
                recommended={opt.recommended} destructive={opt.destructive || (q as { destructive?: boolean }).destructive}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(i())} onChoose={() => props.onChoose(i())} />
            )
          }}
        </For>
      </Show>

      {/* binary_gate */}
      <Show when={q.type === "binary_gate"}>
        {(() => {
          const bq = q as { consequence?: string; default?: string; destructive?: boolean }
          const an = ans()
          const val = an?.type === "binary_gate" ? an.value : false
          return (
            <>
              <OptRow i={0} n={1} label="Yes" desc={bq.consequence ?? ""}
                marker={val ? "●" : "○"} checkmark={val}
                recommended={bq.default === "yes" && !bq.destructive}
                destructive={bq.destructive}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(0)} onChoose={() => props.onChoose(0)} />
              <OptRow i={1} n={2} label="No" desc=""
                marker={!val ? "●" : "○"} checkmark={!val}
                recommended={bq.default === "no" || bq.destructive === true}
                destructive={false}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(1)} onChoose={() => props.onChoose(1)} />
            </>
          )
        })()}
      </Show>

      {/* disambiguation */}
      <Show when={q.type === "disambiguation" && "options" in q}>
        <For each={(q as { mode: string; options: Array<{ id: string; label: string; implies?: string; recommended?: boolean }> }).options}>
          {(opt, i) => {
            const an = ans()
            const selVal = an?.type === "disambiguation" ? an.selection : ""
            const mode = (q as { mode: string }).mode
            const hit = mode === "single" ? selVal === opt.id : Array.isArray(selVal) && selVal.includes(opt.id)
            return (
              <OptRow i={i()} n={i() + 1} label={opt.label} desc={opt.implies ?? ""}
                marker={mode === "single" ? (hit ? "●" : "○") : `[${hit ? "✓" : " "}]`}
                checkmark={hit} recommended={opt.recommended}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(i())} onChoose={() => props.onChoose(i())} />
            )
          }}
        </For>
      </Show>

      {/* ranking */}
      <Show when={q.type === "ranking" && "items" in q}>
        <For each={(q as { items: Array<{ id: string; label: string; suggested_rank?: number }> }).items}>
          {(item, i) => {
            const an = ans()
            const order = an?.type === "ranking" ? an.order : []
            const rank = order.indexOf(item.id)
            const displayRank = rank === -1 ? "?" : `${rank + 1}`
            return (
              <OptRow i={i()} n={i() + 1}
                label={`#${displayRank}  ${item.label}`}
                desc={item.suggested_rank ? `suggested: #${item.suggested_rank}` : ""}
                marker="" checkmark={false}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(i())} onChoose={() => {}} />
            )
          }}
        </For>
        <Show when={props.active}>
          <box paddingLeft={3} paddingBottom={1}>
            <text fg={t.muted}>K/J move item up/down · enter locks order</text>
          </box>
        </Show>
      </Show>

      {/* pairwise */}
      <Show when={q.type === "pairwise"}>
        {(() => {
          const pq = q as { option_a: { id: string; sample: string }; option_b: { id: string; sample: string }; default?: string }
          const an = ans()
          const winner = an?.type === "pairwise" ? an.winner : ""
          return (
            <>
              <OptRow i={0} n={1} label={`A: ${pq.option_a.sample}`} desc=""
                marker={winner === pq.option_a.id ? "●" : "○"} checkmark={winner === pq.option_a.id}
                recommended={pq.default === pq.option_a.id}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(0)} onChoose={() => props.onChoose(0)} />
              <OptRow i={1} n={2} label={`B: ${pq.option_b.sample}`} desc=""
                marker={winner === pq.option_b.id ? "●" : "○"} checkmark={winner === pq.option_b.id}
                recommended={pq.default === pq.option_b.id}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(1)} onChoose={() => props.onChoose(1)} />
            </>
          )
        })()}
      </Show>

      {/* plan_approval */}
      <Show when={q.type === "plan_approval"}>
        {(() => {
          const pq = q as {
            steps: Array<{ id: string; text: string; destructive?: boolean }>
            decisions: string[]
            default?: string
          }
          return (
            <>
              <text fg={t.muted} wrapMode="word">Steps:</text>
              <For each={pq.steps}>
                {(step, i) => (
                  <box paddingLeft={3}>
                    <text fg={step.destructive ? t.error : t.text} wrapMode="word">
                      {step.destructive ? "⚠ " : ""}{i() + 1}. {step.text}
                    </text>
                  </box>
                )}
              </For>
              <For each={pq.decisions}>
                {(dec, i) => {
                  const an = ans()
                  const selected = an?.type === "plan_approval" && an.decision === dec
                  return (
                    <OptRow i={i()} n={i() + 1}
                      label={`[${dec[0]}]${dec.slice(1)}`} desc=""
                      marker={selected ? "●" : "○"} checkmark={selected}
                      recommended={pq.default === dec}
                      cursor={cursor} theme={t} disabled={props.disabled}
                      onMark={() => props.onMark(i())} onChoose={() => props.onChoose(i())} />
                  )
                }}
              </For>
            </>
          )
        })()}
      </Show>

      {/* diff_review */}
      <Show when={q.type === "diff_review"}>
        {(() => {
          const dq = q as {
            artifact_ref: string
            blast_radius?: string
            decisions: string[]
            default?: string
          }
          return (
            <>
              <box paddingLeft={1}>
                <text fg={t.muted} wrapMode="word">Artifact: {dq.artifact_ref}</text>
              </box>
              <Show when={dq.blast_radius}>
                <box paddingLeft={1}>
                  <text fg={dq.blast_radius === "high" ? t.error : t.muted} wrapMode="word">
                    Blast radius: {dq.blast_radius}
                  </text>
                </box>
              </Show>
              <For each={dq.decisions}>
                {(dec, i) => {
                  const an = ans()
                  const selected = an?.type === "diff_review" && an.decision === dec
                  const label = dec === "request_changes" ? "[c]hange request" : `[${dec[0]}]${dec.slice(1)}`
                  return (
                    <OptRow i={i()} n={i() + 1} label={label} desc=""
                      marker={selected ? "●" : "○"} checkmark={selected}
                      recommended={dq.default === dec}
                      cursor={cursor} theme={t} disabled={props.disabled}
                      onMark={() => props.onMark(i())} onChoose={() => props.onMark(i())} />
                  )
                }}
              </For>
            </>
          )
        })()}
      </Show>

      {/* editable_default */}
      <Show when={q.type === "editable_default"}>
        {(() => {
          const eq = q as { prefill: string; used_for?: string }
          return (
            <>
              <box paddingLeft={1}>
                <text fg={t.muted} wrapMode="word">Default: {eq.prefill}</text>
                {eq.used_for && <text fg={t.muted} wrapMode="word">Used for: {eq.used_for}</text>}
              </box>
              <Show when={props.active && props.state.editing}>
                <box paddingLeft={1} paddingTop={1}>
                  <textarea width="100%" minHeight={1} maxHeight={4} wrapMode="word"
                    placeholder="Edit the value…" placeholderColor={t.muted}
                    textColor={t.text} focusedTextColor={t.text}
                    backgroundColor={t.surface} focusedBackgroundColor={t.surface}
                    cursorColor={t.text} focused={!props.disabled}
                    onSubmit={props.saveCustom}
                    onContentChange={() => {
                      if (!props.areaVar || props.areaVar.isDestroyed || props.disabled) return
                      props.setState((prev) => questionStoreCustom(prev, prev.tab, props.areaVar!.plainText))
                    }}
                    ref={(item) => { /* eslint-disable-next-line */ (props as { areaVar: TextareaRenderable | undefined }).areaVar = item }} />
                </box>
              </Show>
            </>
          )
        })()}
      </Show>

      {/* form */}
      <Show when={q.type === "form"}>
        <For each={(q as { fields: Array<{ id: string; type: string; label?: string; default?: unknown }> }).fields}>
          {(field) => {
            const an = ans()
            const val = an?.type === "form" ? an.values[field.id] : undefined
            return (
              <box paddingLeft={1} flexDirection="row" gap={1} paddingBottom={0.5}>
                <text fg={t.text}>{field.label ?? field.id}:</text>
                <text fg={val !== undefined ? t.success : t.muted}>
                  {val !== undefined ? `${val}` : "(not set)"}
                </text>
              </box>
            )
          }}
        </For>
      </Show>

      {/* resource_picker */}
      <Show when={q.type === "resource_picker" && "items" in q}>
        <For each={(q as { items: Array<{ id: string; label: string; meta?: string; recommended?: boolean }> }).items}>
          {(item, i) => {
            const an = ans()
            const picked = an?.type === "resource_picker" && an.selection === item.id
            return (
              <OptRow i={i()} n={i() + 1} label={item.label} desc={item.meta ?? ""}
                marker={picked ? "●" : "○"} checkmark={picked}
                recommended={item.recommended}
                cursor={cursor} theme={t} disabled={props.disabled}
                onMark={() => props.onMark(i())} onChoose={() => props.onChoose(i())} />
            )
          }}
        </For>
      </Show>

      {/* free_text */}
      <Show when={q.type === "free_text"}>
        {(() => {
          const fq = q as { placeholder?: string }
          return (
            <>
              <box paddingLeft={1}>
                <text fg={t.muted} wrapMode="word">{fq.placeholder ?? "Enter your response…"}</text>
              </box>
              <Show when={props.active && props.state.editing}>
                <box paddingLeft={1} paddingTop={1}>
                  <textarea width="100%" minHeight={1} maxHeight={4} wrapMode="word"
                    placeholder={fq.placeholder ?? "Type your answer"}
                    placeholderColor={t.muted} textColor={t.text} focusedTextColor={t.text}
                    backgroundColor={t.surface} focusedBackgroundColor={t.surface}
                    cursorColor={t.text} focused={!props.disabled}
                    onSubmit={props.saveCustom}
                    onContentChange={() => {
                      if (!props.areaVar || props.areaVar.isDestroyed || props.disabled) return
                      props.setState((prev) => questionStoreCustom(prev, prev.tab, props.areaVar!.plainText))
                    }}
                    ref={(item) => { (props as { areaVar: TextareaRenderable | undefined }).areaVar = item }} />
                </box>
              </Show>
            </>
          )
        })()}
      </Show>

      {/* comment option */}
      <Show when={hasComment}>
        <OptRow i={commentIdx()} n={commentIdx() + 1}
          label="✎ Other / comment" desc="Add additional context"
          marker={props.active && sel() === commentIdx() ? "✎ " : "  "}
          checkmark={false} cursor={cursor} theme={t} disabled={props.disabled}
          onMark={() => props.onMark(commentIdx())}
          onChoose={() => props.onChoose(commentIdx())} />
      </Show>
    </box>
  )
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
  theme: RunFooterTheme
  disabled: boolean
  onMark: () => void
  onChoose: () => void
}) {
  const active = props.cursor(props.i)
  const fg = () =>
    active ? props.theme.highlight
    : props.recommended ? props.theme.success
    : props.checkmark ? props.theme.success
    : props.theme.text
  return (
    <box flexDirection="column" gap={0}
      onMouseOver={() => { if (!props.disabled) props.onMark() }}
      onMouseDown={() => { if (!props.disabled) props.onMark() }}
      onMouseUp={() => { if (!props.disabled) props.onChoose() }}
    >
      <box flexDirection="row" gap={1}>
        <box backgroundColor={active ? props.theme.line : undefined} paddingRight={1}>
          <text fg={active ? props.theme.highlight : props.theme.muted}>{props.n}.</text>
        </box>
        <box backgroundColor={active ? props.theme.line : undefined}>
          <text fg={fg()}>
            {props.marker ? `${props.marker} ` : ""}{props.label}
            {props.destructive ? " ⚠" : ""}
          </text>
        </box>
      </box>
      <Show when={props.desc}>
        <box paddingLeft={4}><text fg={props.theme.muted} wrapMode="word">{props.desc}</text></box>
      </Show>
    </box>
  )
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
