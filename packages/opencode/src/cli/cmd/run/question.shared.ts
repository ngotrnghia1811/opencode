// Pure state machine for the batch-question UI.
//
// Supports multi-question batch flows with typed per-question answers.
// Questions are organized across PAST/PRESENT/FUTURE/CLOSING sections.
// Each question type produces a typed AnswerItem.
//
// State transitions:
//   questionSelect    → picks an option (per-type behaviour)
//   questionToggle    → toggles a multi-select option on/off
//   questionMove      → arrow key navigation through options
//   questionMoveRank  → reorder ranking items (up/down)
//   questionSetTab    → tab navigation between questions (across sections)
//   questionSubmit    → builds the final reply with all answers
//   questionAcceptAll → seeds unanswered questions with defaults, submits
//   questionReject    → rejects the batch
//
// Accept-all: destructive items remain unchecked; defaults are pre-seeded.
import type {
  QuestionAnswerItem,
  QuestionBatchPrompt,
  QuestionItem,
  QuestionRequest,
} from "@opencode-ai/sdk/v2"
import type { QuestionReject, QuestionReply } from "./types"

export type QuestionBodyState = {
  requestID: string
  tab: number
  answers: QuestionAnswerItem[]
  custom: string[]
  selected: number
  editing: boolean
  submitting: boolean
  mode: "build" | "confirm"
}

export type QuestionStep = {
  state: QuestionBodyState
  reply?: QuestionReply
}

// ─── Flatten batch into ordered question array ────────────────────────────────

export function allQuestions(batch: QuestionBatchPrompt): QuestionItem[] {
  return [
    ...(batch.past ?? []),
    ...(batch.present ?? []),
    ...(batch.future ?? []),
    ...(batch.closing ? [batch.closing] : []),
  ]
}

export function totalQuestions(batch: QuestionBatchPrompt): number {
  return (
    (batch.past?.length ?? 0) +
    (batch.present?.length ?? 0) +
    (batch.future?.length ?? 0) +
    (batch.closing ? 1 : 0)
  )
}

// ─── Section helpers ──────────────────────────────────────────────────────────

export const SECTION_NAMES = ["PAST", "PRESENT", "FUTURE", "CLOSING"] as const

export function sectionForIndex(batch: QuestionBatchPrompt, index: number): number {
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

export function sectionLabel(sectionIndex: number): string {
  const labels = [
    "PAST — confirm what I'm building on",
    "PRESENT — confirm current objective & scope",
    "FUTURE — lock direction & guardrails",
    "FINAL — anything I missed?",
  ]
  return labels[sectionIndex] ?? ""
}

// ─── Default seeding ──────────────────────────────────────────────────────────

export function emptyAnswer(type: QuestionItem["type"]): QuestionAnswerItem {
  switch (type) {
    case "single_select":
      return { type: "single_select", selection: "" }
    case "multi_select":
      return { type: "multi_select", selections: [] }
    case "binary_gate":
      return { type: "binary_gate", value: false }
    case "disambiguation":
      return { type: "disambiguation", selection: "" }
    case "ranking":
      return { type: "ranking", order: [] }
    case "pairwise":
      return { type: "pairwise", winner: "", no_preference: true }
    case "plan_approval":
      return { type: "plan_approval", decision: "reject" }
    case "diff_review":
      return { type: "diff_review", decision: "reject" }
    case "editable_default":
      return { type: "editable_default", value: "" }
    case "form":
      return { type: "form", values: {} }
    case "resource_picker":
      return { type: "resource_picker", selection: "" }
    case "free_text":
      return { type: "free_text", value: "" }
  }
}

export function seedDefault(q: QuestionItem): QuestionAnswerItem {
  // Destructive questions: never seed — must stay unchecked
  const destructive = (q as { destructive?: boolean }).destructive
  if (destructive) return emptyAnswer(q.type)

  switch (q.type) {
    case "single_select":
      return isSingleSelect(q) && q.default
        ? { type: "single_select", selection: q.default }
        : emptyAnswer(q.type)
    case "multi_select":
      return isMultiSelect(q) && q.default && q.default.length > 0
        ? { type: "multi_select", selections: q.default }
        : emptyAnswer(q.type)
    case "binary_gate": {
      const bgDefault = isBinaryGate(q) ? q.default : undefined
      return bgDefault
        ? { type: "binary_gate", value: bgDefault === "yes" }
        : emptyAnswer(q.type)
    }
    case "disambiguation": {
      const dq = q as { mode: string; default?: string | string[] }
      if (dq.default) {
        if (dq.mode === "single" && typeof dq.default === "string")
          return { type: "disambiguation", selection: dq.default }
        if (dq.mode === "multi" && Array.isArray(dq.default))
          return { type: "disambiguation", selection: dq.default }
      }
      return emptyAnswer(q.type)
    }
    case "ranking": {
      const rq = q as { items: Array<{ id: string; suggested_rank?: number }> }
      return {
        type: "ranking",
        order: [...rq.items]
          .sort((a, b) => (a.suggested_rank ?? 999) - (b.suggested_rank ?? 999))
          .map((i) => i.id),
      }
    }
    case "pairwise": {
      const pq = q as { default?: string }
      return pq.default
        ? { type: "pairwise", winner: pq.default, no_preference: false }
        : emptyAnswer(q.type)
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
      for (const f of fq.fields) {
        if (f.default !== undefined) values[f.id] = f.default
      }
      return { type: "form", values }
    }
    case "resource_picker": {
      const rq = q as { default?: string }
      return rq.default
        ? { type: "resource_picker", selection: rq.default }
        : emptyAnswer(q.type)
    }
    case "free_text":
      return { type: "free_text", value: "" }
  }
}

// ─── State factory ────────────────────────────────────────────────────────────

export function createQuestionBodyState(
  requestID: string,
  batch?: QuestionBatchPrompt,
): QuestionBodyState {
  const answers = batch ? allQuestions(batch).map(seedDefault) : []
  return {
    requestID,
    tab: 0,
    answers,
    custom: [],
    selected: 0,
    editing: false,
    submitting: false,
    mode: "build",
  }
}

export function questionSync(
  state: QuestionBodyState,
  requestID: string,
  batch?: QuestionBatchPrompt,
): QuestionBodyState {
  if (state.requestID === requestID) return state
  return createQuestionBodyState(requestID, batch)
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function questionSingle(batch: QuestionBatchPrompt): boolean {
  return totalQuestions(batch) === 1
}

export function questionTabs(batch: QuestionBatchPrompt): number {
  const total = totalQuestions(batch)
  return total <= 1 ? 1 : total + 1 // +1 for confirm tab
}

export function questionConfirm(
  batch: QuestionBatchPrompt,
  state: QuestionBodyState,
): boolean {
  return !questionSingle(batch) && state.tab === totalQuestions(batch)
}

export function questionInfo(
  batch: QuestionBatchPrompt,
  state: QuestionBodyState,
): QuestionItem | undefined {
  return allQuestions(batch)[state.tab]
}

export function questionInput(state: QuestionBodyState): string {
  return state.custom[state.tab] ?? ""
}

export function questionPicked(state: QuestionBodyState): boolean {
  const ans = state.answers[state.tab]
  if (!ans) return false
  // For multi_select, check if the custom text is in selections
  if (ans.type === "multi_select") {
    const value = questionInput(state)
    return value ? ans.selections.includes(value) : false
  }
  return false
}

// ─── Option counting ──────────────────────────────────────────────────────────

export function questionTotal(
  batch: QuestionBatchPrompt,
  state: QuestionBodyState,
): number {
  const q = questionInfo(batch, state)
  if (!q) return 0
  const options = optionCount(q)
  // Add extra for comment_option if present
  return options + (q.comment_option ? 1 : 0)
}

function optionCount(q: QuestionItem): number {
  switch (q.type) {
    case "single_select":
      return q.options.length
    case "multi_select":
      return q.options.length
    case "binary_gate":
      return 2 // Yes / No
    case "disambiguation":
      return q.options.length
    case "ranking":
      return q.items.length
    case "pairwise":
      return 2
    case "plan_approval":
      return q.decisions.length
    case "diff_review":
      return q.decisions.length
    case "resource_picker":
      return q.items.length
    case "editable_default":
    case "form":
    case "free_text":
      return 0 // no numbered options
  }
}

// ─── Tab / cursor state ──────────────────────────────────────────────────────

export function questionAnswers(
  state: QuestionBodyState,
  count: number,
): QuestionAnswerItem[] {
  return Array.from({ length: count }, (_, idx) => state.answers[idx] ?? emptyAnswer("free_text"))
}

export function questionSetTab(state: QuestionBodyState, tab: number): QuestionBodyState {
  return { ...state, tab, selected: 0, editing: false }
}

export function questionSetSelected(
  state: QuestionBodyState,
  selected: number,
): QuestionBodyState {
  return { ...state, selected }
}

export function questionSetEditing(
  state: QuestionBodyState,
  editing: boolean,
): QuestionBodyState {
  return { ...state, editing }
}

export function questionSetSubmitting(
  state: QuestionBodyState,
  submitting: boolean,
): QuestionBodyState {
  return { ...state, submitting }
}

export function questionStoreCustom(
  state: QuestionBodyState,
  tab: number,
  text: string,
): QuestionBodyState {
  const custom = [...state.custom]
  custom[tab] = text
  return { ...state, custom }
}

// ─── Option navigation ────────────────────────────────────────────────────────

export function questionMove(
  state: QuestionBodyState,
  batch: QuestionBatchPrompt,
  dir: -1 | 1,
): QuestionBodyState {
  const total = questionTotal(batch, state)
  if (total === 0) return state
  return { ...state, selected: (state.selected + dir + total) % total }
}

// ─── Per-type selection / mutation ────────────────────────────────────────────

function isSingleSelect(
  q: QuestionItem,
): q is QuestionItem & { type: "single_select" } {
  return q.type === "single_select"
}

function isMultiSelect(
  q: QuestionItem,
): q is QuestionItem & { type: "multi_select" } {
  return q.type === "multi_select"
}

function isBinaryGate(
  q: QuestionItem,
): q is QuestionItem & { type: "binary_gate" } {
  return q.type === "binary_gate"
}

function isDisambiguation(
  q: QuestionItem,
): q is QuestionItem & { type: "disambiguation" } {
  return q.type === "disambiguation"
}

function isRanking(q: QuestionItem): q is QuestionItem & { type: "ranking" } {
  return q.type === "ranking"
}

function isPairwise(q: QuestionItem): q is QuestionItem & { type: "pairwise" } {
  return q.type === "pairwise"
}

function isPlanApproval(
  q: QuestionItem,
): q is QuestionItem & { type: "plan_approval" } {
  return q.type === "plan_approval"
}

function isDiffReview(
  q: QuestionItem,
): q is QuestionItem & { type: "diff_review" } {
  return q.type === "diff_review"
}

function isEditableDefault(
  q: QuestionItem,
): q is QuestionItem & { type: "editable_default" } {
  return q.type === "editable_default"
}

function isForm(q: QuestionItem): q is QuestionItem & { type: "form" } {
  return q.type === "form"
}

function isResourcePicker(
  q: QuestionItem,
): q is QuestionItem & { type: "resource_picker" } {
  return q.type === "resource_picker"
}

// ─── Apply answer at tab ─────────────────────────────────────────────────────

function setAnswer(
  state: QuestionBodyState,
  answer: QuestionAnswerItem,
): QuestionBodyState {
  const answers = [...state.answers]
  answers[state.tab] = answer
  return { ...state, answers }
}

// ─── Select (enter on an option) ──────────────────────────────────────────────

export function questionSelect(
  state: QuestionBodyState,
  batch: QuestionBatchPrompt,
): QuestionStep {
  const q = questionInfo(batch, state)
  if (!q) return { state }

  const options = optionCount(q)
  const hasComment = q.comment_option !== undefined

  // Comment/other option selected
  if (hasComment && state.selected === options) {
    return { state: questionSetEditing(state, true) }
  }

  // Binary gate: enter toggles
  if (isBinaryGate(q)) {
    const cur = state.answers[state.tab]
    const current = cur?.type === "binary_gate" ? cur.value : false
    const next: QuestionAnswerItem = {
      type: "binary_gate",
      value: !current,
    }
    const newState = questionSetEditing(setAnswer(state, next), false)
    if (questionSingle(batch)) {
      return {
        state: newState,
        reply: buildReply(batch, newState),
      }
    }
    return { state: questionSetTab(newState, state.tab + 1) }
  }

  // Multi-select: toggle
  if (isMultiSelect(q)) {
    const opt = q.options[state.selected]
    if (!opt) return { state }
    const cur = state.answers[state.tab]
    const selections =
      cur?.type === "multi_select" ? [...cur.selections] : []
    const idx = selections.indexOf(opt.id)
    if (idx === -1) selections.push(opt.id)
    else selections.splice(idx, 1)
    return {
      state: setAnswer(state, { type: "multi_select", selections }),
    }
  }

  // Single-select: pick and advance
  if (isSingleSelect(q) || isDisambiguation(q) || isResourcePicker(q)) {
    const opt = "options" in q ? (q.options as Array<{ id: string }>)[state.selected] : undefined
    if (!opt) return { state }
    const type = q.type as "single_select" | "disambiguation" | "resource_picker"
    const newState = setAnswer(state, {
      type,
      selection: opt.id,
    } as QuestionAnswerItem)
    if (questionSingle(batch)) {
      return {
        state: newState,
        reply: buildReply(batch, newState),
      }
    }
    return { state: questionSetTab(newState, state.tab + 1) }
  }

  // Pairwise: select A or B
  if (isPairwise(q)) {
    const winner = state.selected === 0 ? q.option_a.id : q.option_b.id
    const newState = setAnswer(state, {
      type: "pairwise",
      winner,
      no_preference: false,
    })
    if (questionSingle(batch)) {
      return {
        state: newState,
        reply: buildReply(batch, newState),
      }
    }
    return { state: questionSetTab(newState, state.tab + 1) }
  }

  // Plan approval / diff review: pick decision
  if (isPlanApproval(q)) {
    const dec = q.decisions[state.selected]
    if (!dec) return { state }
    const newState = setAnswer(state, {
      type: "plan_approval",
      decision: dec,
    })
    if (questionSingle(batch)) {
      return {
        state: newState,
        reply: buildReply(batch, newState),
      }
    }
    return { state: questionSetTab(newState, state.tab + 1) }
  }

  if (isDiffReview(q)) {
    const dec = q.decisions[state.selected]
    if (!dec) return { state }
    const newState = setAnswer(state, {
      type: "diff_review",
      decision: dec,
    })
    if (questionSingle(batch)) {
      return {
        state: newState,
        reply: buildReply(batch, newState),
      }
    }
    return { state: questionSetTab(newState, state.tab + 1) }
  }

  return { state }
}

// ─── Ranking move-up / move-down ──────────────────────────────────────────────

export function questionMoveRank(
  state: QuestionBodyState,
  batch: QuestionBatchPrompt,
  dir: -1 | 1,
): QuestionBodyState {
  const q = questionInfo(batch, state)
  if (!q || !isRanking(q)) return state

  const cur = state.answers[state.tab]
  const order = cur?.type === "ranking" ? [...cur.order] : []
  if (order.length === 0) return state

  const idx = state.selected
  if (idx < 0 || idx >= order.length) return state

  const newIdx = idx + dir
  if (newIdx < 0 || newIdx >= order.length) return state

  const tmp = order[idx]
  order[idx] = order[newIdx]
  order[newIdx] = tmp

  return {
    ...setAnswer(state, { type: "ranking", order }),
    selected: newIdx,
  }
}

// ─── Save (custom text input) ─────────────────────────────────────────────────

export function questionSave(
  state: QuestionBodyState,
  batch: QuestionBatchPrompt,
): QuestionStep {
  const q = questionInfo(batch, state)
  if (!q) return { state }

  const value = questionInput(state).trim()
  if (!value) return { state: questionSetEditing(state, false) }

  // For editable_default: save as typed value
  if (isEditableDefault(q)) {
    const newState = setAnswer(state, {
      type: "editable_default",
      value,
    })
    return { state: questionSetEditing(newState, false) }
  }

  // For free_text: save as typed value
  if (q.type === "free_text") {
    const newState = setAnswer(state, {
      type: "free_text",
      value,
    })
    return { state: questionSetEditing(newState, false) }
  }

  // For single-select/multi-select with custom option: save as comment on answer
  const cur = state.answers[state.tab]
  if (cur) {
    const withComment = { ...cur, comment: value } as QuestionAnswerItem
    return { state: questionSetEditing(setAnswer(state, withComment), false) }
  }

  return { state: questionSetEditing(state, false) }
}

// ─── Submit ───────────────────────────────────────────────────────────────────

function buildReply(
  batch: QuestionBatchPrompt,
  state: QuestionBodyState,
): QuestionReply {
  return {
    requestID: state.requestID,
    answers: questionAnswers(state, totalQuestions(batch)),
  }
}

export function questionSubmit(
  batch: QuestionBatchPrompt,
  state: QuestionBodyState,
): QuestionReply {
  return buildReply(batch, state)
}

// ─── Accept-all: seed all unanswered, destructive stays unchecked ─────────────

export function questionAcceptAll(
  batch: QuestionBatchPrompt,
  state: QuestionBodyState,
): QuestionReply {
  const all = allQuestions(batch)
  const answers = state.answers.map((ans, i) => {
    const q = all[i]
    if (!q) return ans
    const destructive = (q as { destructive?: boolean }).destructive === true
    if (destructive && isAnswerEmpty(ans)) return ans
    if (isAnswerEmpty(ans)) return seedDefault(q)
    return ans
  })
  return {
    requestID: state.requestID,
    answers,
  }
}

function isAnswerEmpty(ans: QuestionAnswerItem): boolean {
  switch (ans.type) {
    case "single_select":
      return !ans.selection
    case "multi_select":
      return ans.selections.length === 0
    case "binary_gate":
      return false // boolean is never empty
    case "disambiguation":
      return typeof ans.selection === "string"
        ? !ans.selection
        : ans.selection.length === 0
    case "ranking":
      return ans.order.length === 0
    case "pairwise":
      return ans.no_preference === true || !ans.winner
    case "plan_approval":
      return ans.decision === "reject"
    case "diff_review":
      return ans.decision === "reject"
    case "editable_default":
      return !ans.value
    case "form":
      return Object.keys(ans.values).length === 0
    case "resource_picker":
      return !ans.selection
    case "free_text":
      return !ans.value
  }
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export function questionReject(request: { id: string }): QuestionReject {
  return { requestID: request.id }
}
