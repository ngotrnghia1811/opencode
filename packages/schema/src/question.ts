export * as Question from "./question"

import { Schema } from "effect"
import { optional } from "./schema"
import { define, inventory } from "./event"
import { ascending } from "./identifier"
import { SessionID } from "./session-id"
import { statics } from "./schema"

// ─── ID ──────────────────────────────────────────────────────────────────────
export const ID = Schema.String.check(Schema.isStartsWith("que")).pipe(
  Schema.brand("QuestionID"),
  statics((schema) => {
    const create = () => schema.make("que_" + ascending())
    return {
      create,
      ascending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type ID = typeof ID.Type

// ─── Universal tags ──────────────────────────────────────────────────────────
const TimeTag = Schema.Literals(["past", "present", "future"])
const IntentTag = Schema.Literals(["disambiguation", "preference", "alignment"])
const EffortTag = Schema.Literals(["low", "medium", "high"])

// ─── Comment escape ──────────────────────────────────────────────────────────
const CommentOption = Schema.Struct({
  id: Schema.Literal("__other"),
  type: Schema.Literal("free_text"),
  label: optional(Schema.String).annotate({ description: "Label for the comment field" }),
})

// ─── Shared option fields ────────────────────────────────────────────────────
const OptionBase = {
  id: Schema.String.annotate({ description: "Unique option identifier within this question" }),
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  recommended: optional(Schema.Boolean).annotate({ description: "Agent's recommended/default choice" }),
  pros: optional(Schema.Array(Schema.String)).annotate({ description: "Advantages of this option" }),
  cons: optional(Schema.Array(Schema.String)).annotate({ description: "Disadvantages of this option" }),
  implies: optional(Schema.String).annotate({ description: "What choosing this option implies downstream" }),
}

// ─── 12 Question Types ───────────────────────────────────────────────────────

// 1. single_select
export const SingleSelect = Schema.Struct({
  type: Schema.Literal("single_select"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  destructive: optional(Schema.Boolean).annotate({
    description: "True if this question gates a destructive action",
  }),
  options: Schema.Array(Schema.Struct(OptionBase)),
  default: optional(Schema.String).annotate({ description: "Option id of the recommended default selection" }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.SingleSelect" })
export interface SingleSelect extends Schema.Schema.Type<typeof SingleSelect> {}

// 2. multi_select
export const MultiSelect = Schema.Struct({
  type: Schema.Literal("multi_select"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  destructive: optional(Schema.Boolean).annotate({
    description: "True if this question gates a destructive action",
  }),
  min_select: optional(Schema.Number).annotate({ description: "Minimum number of selections required" }),
  options: Schema.Array(
    Schema.Struct({
      ...OptionBase,
      destructive: optional(Schema.Boolean).annotate({ description: "True if this specific option is destructive" }),
    }),
  ),
  default: optional(Schema.Array(Schema.String)).annotate({
    description: "Option ids of the recommended defaults",
  }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.MultiSelect" })
export interface MultiSelect extends Schema.Schema.Type<typeof MultiSelect> {}

// 3. binary_gate
export const BinaryGate = Schema.Struct({
  type: Schema.Literal("binary_gate"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  destructive: optional(Schema.Boolean).annotate({
    description: "True if this question gates a destructive action",
  }),
  consequence: optional(Schema.String).annotate({ description: "What happens if 'yes' is chosen" }),
  default: optional(Schema.Literals(["yes", "no"])).annotate({
    description: "Recommended default (safe: 'no' for destructive)",
  }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.BinaryGate" })
export interface BinaryGate extends Schema.Schema.Type<typeof BinaryGate> {}

// 4. disambiguation
export const Disambiguation = Schema.Struct({
  type: Schema.Literal("disambiguation"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: Schema.Literal("disambiguation"),
  effort: optional(EffortTag),
  mode: Schema.Literals(["single", "multi"]).annotate({
    description: "single for referent pick, multi for scope pick",
  }),
  options: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "Unique option identifier" }),
      label: Schema.String.annotate({ description: "Display text" }),
      implies: optional(Schema.String).annotate({ description: "What choosing this option implies" }),
      recommended: optional(Schema.Boolean).annotate({ description: "Agent's recommended choice" }),
    }),
  ),
  default: optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])).annotate({
    description: "Default selection(s) — string for single mode, array for multi mode",
  }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.Disambiguation" })
export interface Disambiguation extends Schema.Schema.Type<typeof Disambiguation> {}

// 5. ranking
export const Ranking = Schema.Struct({
  type: Schema.Literal("ranking"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  allow_ties: optional(Schema.Boolean).annotate({ description: "Allow items to share the same rank" }),
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "Unique item identifier" }),
      label: Schema.String.annotate({ description: "Display text" }),
      suggested_rank: optional(Schema.Number).annotate({ description: "Agent's suggested rank position (1-based)" }),
    }),
  ),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.Ranking" })
export interface Ranking extends Schema.Schema.Type<typeof Ranking> {}

// 6. pairwise
export const Pairwise = Schema.Struct({
  type: Schema.Literal("pairwise"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  randomize_position: optional(Schema.Boolean).annotate({
    description: "Randomize which option appears first",
  }),
  confirm_if_high_value: optional(Schema.Boolean).annotate({
    description: "Ask for confirmation if the user picks the higher-value option",
  }),
  option_a: Schema.Struct({
    id: Schema.String,
    sample: Schema.String.annotate({ description: "Sample/description of option A" }),
  }),
  option_b: Schema.Struct({
    id: Schema.String,
    sample: Schema.String.annotate({ description: "Sample/description of option B" }),
  }),
  default: optional(Schema.String).annotate({ description: "Option id of the recommended default" }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.Pairwise" })
export interface Pairwise extends Schema.Schema.Type<typeof Pairwise> {}

// 7. plan_approval
export const PlanApproval = Schema.Struct({
  type: Schema.Literal("plan_approval"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  destructive: optional(Schema.Boolean).annotate({
    description: "True if this plan includes destructive steps",
  }),
  steps: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "Unique step identifier" }),
      text: Schema.String.annotate({ description: "Step description" }),
      destructive: optional(Schema.Boolean).annotate({
        description: "True if this step is destructive/irreversible",
      }),
    }),
  ),
  decisions: Schema.Array(Schema.Literals(["approve", "edit", "reject"])).annotate({
    description: "Available decisions",
  }),
  default: optional(Schema.Literals(["approve", "reject"])).annotate({
    description: "Recommended default decision",
  }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.PlanApproval" })
export interface PlanApproval extends Schema.Schema.Type<typeof PlanApproval> {}

// 8. diff_review
export const DiffReview = Schema.Struct({
  type: Schema.Literal("diff_review"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  artifact_ref: Schema.String.annotate({
    description: "Reference to the artifact being reviewed (file, commit, etc.)",
  }),
  blast_radius: optional(Schema.Literals(["low", "medium", "high"])).annotate({
    description: "Estimated impact scope",
  }),
  decisions: Schema.Array(Schema.Literals(["approve", "request_changes", "reject"])).annotate({
    description: "Available decisions",
  }),
  default: optional(Schema.Literals(["approve", "request_changes", "reject"])).annotate({
    description: "Recommended default decision",
  }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.DiffReview" })
export interface DiffReview extends Schema.Schema.Type<typeof DiffReview> {}

// 9. editable_default
export const EditableDefault = Schema.Struct({
  type: Schema.Literal("editable_default"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  prefill: Schema.String.annotate({ description: "The pre-filled default value the user can edit" }),
  used_for: optional(Schema.String).annotate({ description: "What this value will be used for" }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.EditableDefault" })
export interface EditableDefault extends Schema.Schema.Type<typeof EditableDefault> {}

// 10. form
export const Form = Schema.Struct({
  type: Schema.Literal("form"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  fields: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "Unique field identifier" }),
      type: Schema.Literals(["string", "boolean", "select", "number"]).annotate({
        description: "Field data type",
      }),
      label: optional(Schema.String).annotate({ description: "Field label" }),
      required: optional(Schema.Boolean).annotate({ description: "Whether this field is required" }),
      default: optional(Schema.Union([Schema.String, Schema.Boolean, Schema.Number])).annotate({
        description: "Default value",
      }),
      options: optional(Schema.Array(Schema.String)).annotate({ description: "Options for select-type fields" }),
    }),
  ),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.Form" })
export interface Form extends Schema.Schema.Type<typeof Form> {}

// 11. resource_picker
export const ResourcePicker = Schema.Struct({
  type: Schema.Literal("resource_picker"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  source: Schema.String.annotate({
    description: "Where the resource list comes from (file path, git ref, etc.)",
  }),
  searchable: optional(Schema.Boolean).annotate({ description: "Whether the user can type to filter items" }),
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "Unique resource identifier" }),
      label: Schema.String.annotate({ description: "Display text" }),
      meta: optional(Schema.String).annotate({ description: "Additional metadata (hash, date, etc.)" }),
      recommended: optional(Schema.Boolean).annotate({ description: "Agent's recommended pick" }),
    }),
  ),
  default: optional(Schema.String).annotate({ description: "Option id of the recommended default" }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.ResourcePicker" })
export interface ResourcePicker extends Schema.Schema.Type<typeof ResourcePicker> {}

// 12. free_text
export const FreeText = Schema.Struct({
  type: Schema.Literal("free_text"),
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  time: optional(TimeTag),
  intent: optional(IntentTag),
  effort: optional(EffortTag),
  placeholder: optional(Schema.String).annotate({ description: "Placeholder text for the input" }),
  required: optional(Schema.Boolean).annotate({ description: "Whether an answer is required" }),
  comment_option: optional(CommentOption),
}).annotate({ identifier: "Question.FreeText" })
export interface FreeText extends Schema.Schema.Type<typeof FreeText> {}

// ─── Discriminated union of all 12 question types ────────────────────────────
export const QuestionItem = Schema.Union([
  SingleSelect,
  MultiSelect,
  BinaryGate,
  Disambiguation,
  Ranking,
  Pairwise,
  PlanApproval,
  DiffReview,
  EditableDefault,
  Form,
  ResourcePicker,
  FreeText,
]).annotate({ identifier: "Question.Item" })
export type QuestionItem = typeof QuestionItem.Type

// ─── Batch ───────────────────────────────────────────────────────────────────

function countBatchQuestions(batch: {
  readonly past?: ReadonlyArray<QuestionItem>
  readonly present?: ReadonlyArray<QuestionItem>
  readonly future?: ReadonlyArray<QuestionItem>
  readonly closing?: typeof FreeText.Type
}) {
  return (batch.past?.length ?? 0) + (batch.present?.length ?? 0) + (batch.future?.length ?? 0) + (batch.closing ? 1 : 0)
}

const BatchBase = Schema.Struct({
  task: Schema.String.annotate({ description: "Short task label for the batch header" }),
  summary: Schema.String.annotate({ description: "One-sentence summary of what this batch confirms" }),
  past: optional(Schema.Array(QuestionItem)).annotate({ description: "Questions confirming inherited state" }),
  present: optional(Schema.Array(QuestionItem)).annotate({
    description: "Questions confirming current objective and scope",
  }),
  future: optional(Schema.Array(QuestionItem)).annotate({
    description: "Questions locking future direction and guardrails",
  }),
  closing: optional(FreeText).annotate({
    description: "Optional free-text closing question (e.g. 'anything I missed?')",
  }),
})

export const BatchPrompt = BatchBase.pipe(
  Schema.check(
    Schema.makeFilter(
      (batch, _ast, _options) => {
        const count = countBatchQuestions(batch)
        return count >= 4 ? undefined : "Batch must contain at least 4 questions across all horizons"
      },
      { description: "ALWAYS-BATCH: batch must contain at least 4 questions" },
    ),
  ),
).annotate({ identifier: "Question.BatchPrompt" })
export interface BatchPrompt extends Schema.Schema.Type<typeof BatchPrompt> {}

// ─── Tool ────────────────────────────────────────────────────────────────────
export const Tool = Schema.Struct({
  messageID: Schema.String,
  callID: Schema.String,
}).annotate({ identifier: "Question.Tool" })
export interface Tool extends Schema.Schema.Type<typeof Tool> {}

// ─── Request ─────────────────────────────────────────────────────────────────
export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  batch: BatchPrompt,
  tool: optional(Tool),
}).annotate({ identifier: "Question.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

// ─── 12 Answer Types (tagged union on `type`) ────────────────────────────────

// 1. single_select answer
export const SingleSelectAnswer = Schema.Struct({
  type: Schema.Literal("single_select"),
  selection: Schema.String.annotate({ description: "Selected option id" }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.SingleSelectAnswer" })
export interface SingleSelectAnswer extends Schema.Schema.Type<typeof SingleSelectAnswer> {}

// 2. multi_select answer
export const MultiSelectAnswer = Schema.Struct({
  type: Schema.Literal("multi_select"),
  selections: Schema.Array(Schema.String).annotate({ description: "Selected option ids" }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.MultiSelectAnswer" })
export interface MultiSelectAnswer extends Schema.Schema.Type<typeof MultiSelectAnswer> {}

// 3. binary_gate answer
export const BinaryGateAnswer = Schema.Struct({
  type: Schema.Literal("binary_gate"),
  value: Schema.Boolean.annotate({ description: "true = yes, false = no" }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.BinaryGateAnswer" })
export interface BinaryGateAnswer extends Schema.Schema.Type<typeof BinaryGateAnswer> {}

// 4. disambiguation answer
export const DisambiguationAnswer = Schema.Struct({
  type: Schema.Literal("disambiguation"),
  selection: Schema.Union([Schema.String, Schema.Array(Schema.String)]).annotate({
    description: "Selected option id(s) — string for single mode, array for multi mode",
  }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.DisambiguationAnswer" })
export interface DisambiguationAnswer extends Schema.Schema.Type<typeof DisambiguationAnswer> {}

// 5. ranking answer
export const RankingAnswer = Schema.Struct({
  type: Schema.Literal("ranking"),
  order: Schema.Array(Schema.String).annotate({
    description: "Ordered item ids (first = highest priority)",
  }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.RankingAnswer" })
export interface RankingAnswer extends Schema.Schema.Type<typeof RankingAnswer> {}

// 6. pairwise answer
export const PairwiseAnswer = Schema.Struct({
  type: Schema.Literal("pairwise"),
  winner: Schema.String.annotate({ description: "Id of the chosen option" }),
  no_preference: optional(Schema.Boolean).annotate({ description: "True if user has no preference" }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.PairwiseAnswer" })
export interface PairwiseAnswer extends Schema.Schema.Type<typeof PairwiseAnswer> {}

// 7. plan_approval answer
export const PlanApprovalAnswer = Schema.Struct({
  type: Schema.Literal("plan_approval"),
  decision: Schema.Literals(["approve", "edit", "reject"]).annotate({ description: "Decision for the plan" }),
  notes: optional(Schema.String).annotate({ description: "Notes for edit or reject decisions" }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.PlanApprovalAnswer" })
export interface PlanApprovalAnswer extends Schema.Schema.Type<typeof PlanApprovalAnswer> {}

// 8. diff_review answer
export const DiffReviewAnswer = Schema.Struct({
  type: Schema.Literal("diff_review"),
  decision: Schema.Literals(["approve", "request_changes", "reject"]).annotate({
    description: "Decision for the diff",
  }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.DiffReviewAnswer" })
export interface DiffReviewAnswer extends Schema.Schema.Type<typeof DiffReviewAnswer> {}

// 9. editable_default answer
export const EditableDefaultAnswer = Schema.Struct({
  type: Schema.Literal("editable_default"),
  value: Schema.String.annotate({ description: "The (possibly edited) value" }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.EditableDefaultAnswer" })
export interface EditableDefaultAnswer extends Schema.Schema.Type<typeof EditableDefaultAnswer> {}

// 10. form answer
export const FormAnswer = Schema.Struct({
  type: Schema.Literal("form"),
  values: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean, Schema.Number])).annotate({
    description: "Field id → value map",
  }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.FormAnswer" })
export interface FormAnswer extends Schema.Schema.Type<typeof FormAnswer> {}

// 11. resource_picker answer
export const ResourcePickerAnswer = Schema.Struct({
  type: Schema.Literal("resource_picker"),
  selection: Schema.String.annotate({ description: "Selected resource id" }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.ResourcePickerAnswer" })
export interface ResourcePickerAnswer extends Schema.Schema.Type<typeof ResourcePickerAnswer> {}

// 12. free_text answer
export const FreeTextAnswer = Schema.Struct({
  type: Schema.Literal("free_text"),
  value: Schema.String.annotate({ description: "The user's text response" }),
  comment: optional(Schema.String).annotate({ description: "Free-text comment/other escape" }),
}).annotate({ identifier: "Question.FreeTextAnswer" })
export interface FreeTextAnswer extends Schema.Schema.Type<typeof FreeTextAnswer> {}

// ─── Answer discriminated union ──────────────────────────────────────────────
export const AnswerItem = Schema.Union([
  SingleSelectAnswer,
  MultiSelectAnswer,
  BinaryGateAnswer,
  DisambiguationAnswer,
  RankingAnswer,
  PairwiseAnswer,
  PlanApprovalAnswer,
  DiffReviewAnswer,
  EditableDefaultAnswer,
  FormAnswer,
  ResourcePickerAnswer,
  FreeTextAnswer,
]).annotate({ identifier: "Question.AnswerItem" })
export type AnswerItem = typeof AnswerItem.Type

// ─── BatchAnswer ─────────────────────────────────────────────────────────────
export const BatchAnswer = Schema.Struct({
  requestID: ID,
  answers: Schema.Array(AnswerItem).annotate({
    description: "Answers corresponding to each question in the batch",
  }),
}).annotate({ identifier: "Question.BatchAnswer" })
export interface BatchAnswer extends Schema.Schema.Type<typeof BatchAnswer> {}

// ─── Reply (wire type, omits requestID) ─────────────────────────────────────
export const Reply = Schema.Struct({
  answers: Schema.Array(AnswerItem).annotate({
    description: "Answers corresponding to each question in the batch",
  }),
}).annotate({ identifier: "Question.Reply" })
export interface Reply extends Schema.Schema.Type<typeof Reply> {}

// ─── Events ──────────────────────────────────────────────────────────────────
const Asked = define({ type: "question.asked", schema: Request.fields })
const RepliedEvent = define({
  type: "question.replied",
  schema: {
    sessionID: SessionID,
    requestID: ID,
    answers: Schema.Array(AnswerItem),
  },
})
const RejectedEvent = define({
  type: "question.rejected",
  schema: {
    sessionID: SessionID,
    requestID: ID,
  },
})
export const Event = {
  Asked,
  Replied: RepliedEvent,
  Rejected: RejectedEvent,
  Definitions: inventory(Asked, RepliedEvent, RejectedEvent),
}
