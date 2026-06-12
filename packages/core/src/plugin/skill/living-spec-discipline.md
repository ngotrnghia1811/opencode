# Living Spec Discipline — aki-sidekick

## Overview

This skill teaches the **living spec** — a spec that evolves across the full
session, from initial elicitation through execution to final review. Unlike
a one-shot spec that is written once and frozen, the living spec is versioned,
logged, and continuously realigned with the human's intent.

**Core principle:** The spec is never "done." It is seeded from elicitation,
approved by the human, and revised on every realignment, replan, or new
discovery. Version everything. Log every decision.

### Supersedes one-shot spec generation

This skill extends — not replaces — `create-specification` (github/awesome-copilot).
The one-shot pattern produces an immutable snapshot. The living spec adds:

- A version counter incremented on every material change
- A decision log (ADR-style entries for every phase transition and human override)
- Realignment notes when the human redirects mid-execution
- An uncertainty ledger with open questions resolved progressively
- Integration with aki-main's evolving plan and todo as the canonical store — not a standalone file

It also extends `planning-and-task-breakdown` (addyosmani/agent-skills) with
plan inspection, replanning, and risk gating from the spec.

### Spec invariants enforced

- **P5 (spec as shared source of truth):** The entire skill maintains the spec as the canonical alignment artifact for human and aki-main
- **P4 (persistent narrative, ephemeral aki-main):** Decision log and versioning provide persistent narrative; aki-main gets scoped slices
- **§4 (state architecture), §5.1 (spec artifact), §5.2 (plan artifact):** Implements the state schema and artifact specifications

---

## Spec Anatomy

The canonical spec lives in aki-main's evolving plan as a structured block:

```yaml
spec:
  version: <int — increment on every material change>
  objective: <single sentence — what we are building>
  constraints: [<hard limits — must not violate>]
  non_goals: [<explicit exclusions — will not do>]
  success_criteria: [<testable acceptance conditions>]
```

### Field requirements

- **`objective`** — One sentence. No conjunctions, no "and also." If the
  objective needs two sentences, the spec isn't focused enough. aki-main
  reads this first; it must be unambiguous.
- **`constraints`** — Hard limits. Violating any constraint = spec
  noncompliance. Example: "Redis not available in test environment." Not:
  "should be fast" (not testable — belongs in success_criteria).
- **`non_goals`** — Explicit exclusions. What we will NOT do. Prevents scope
  creep. Example: "Will not modify the auth module."
- **`success_criteria`** — Testable acceptance conditions. Each criterion must
  be evaluable as true/false from aki-main's output. Example: "Benchmark
  shows p99 cache read latency < 5ms under 5000 req/s." Not: "Cache is faster."

### Must NOT be in the spec

- Implementation details (what algorithm, what library) — those are plan decisions
- Task ordering (what to do first) — that's the plan / task graph
- File paths (where to put the code) — that's scope_boundary in the plan
- Tool usage (what commands to run) — that's aki-main's execution domain

---

## The Living-Document Workflow

### Phase ELICIT — Seed the Spec

1. aki-main receives human intent in natural language.
2. aki-main uses aki-clarify for the clarifying-question ritual. Ask structured
   questions to resolve ambiguities — never guess.
3. aki-main receives the Contract YAML (the human's structured intent).
4. aki-main seeds the `spec` block from the Contract. Every ambiguity the
   Contract leaves unresolved → add as an `open_question` in the uncertainty
   ledger.
5. aki-main sets `spec.version = 1`.
6. aki-main presents the draft spec to the human. Gate: all `open_questions`
   resolved by the human.

**Elicitation rule:** Every ambiguity in human intent that aki-main cannot
resolve by inference must surface as a question. Never silently fill. "I assumed
you meant X" is a bug, not a feature.

**Sidekick observation:** aki-sidekick checks whether aki-main surfaced
ambiguities as questions or silently filled gaps. Silently filled gaps that
cause downstream misalignment are classified as `plan_quality` faults
(see critique-fault-taxonomy skill).

### Phase SPEC — Approve and Version

1. aki-main writes a `decision_log` entry on human approval:
   ```yaml
   - id: "D-001"
     phase: SPEC
     decision: "spec approved — project structure with cache module"
     rationale: "human confirmed the scope: src/cache/ with Redis fallback"
     timestamp: "2026-06-06T10:00:00Z"
     made_by: human
   ```
2. aki-main bumps `spec.version` on human revision, applies changes, logs the
   decision with rationale for each change.
3. Gate: human explicit approval before advancing to PLAN. No implicit
   approval. "Looks good" counts.

**Sidekick observation:** aki-sidekick observes whether the spec version is
bumped on every material change and whether decision log entries are written
for phase transitions. Missing version bumps or missing decision log entries
are flagged as SIDEKICK comments with `action: review`.

### Phase PLAN — Decompose from Spec

1. aki-main decomposes the approved spec into a DAG of subtask nodes. See the
   plan-inspection-checklist skill for decomposition rules.
2. Every `success_criterion` must have ≥1 task node covering it. aki-main maps
   criteria to nodes explicitly and flags uncovered criteria.
3. aki-main writes the `task_graph` to its todo list.
4. aki-main runs plan inspection (see plan-inspection-checklist skill). Do not
   release an uninspected plan.
5. aki-main presents the plan to the human. Gate: human approval.

**Sidekick observation:** aki-sidekick observes whether every `success_criterion`
has ≥1 task node mapped to it. Uncovered criteria are flagged as SIDEKICK
comments with `action: review`. Missing plan inspection is flagged.

### Phase EXECUTE — Spec as Constraint

1. Every subtask handoff to aki-main includes a scoped spec slice: `objective`,
   relevant `constraints`, and `success_signal`. aki-main does not receive the
   full spec — it receives only what it needs for this subtask.
2. The sidekick observes every aki-main output against the spec using the §6.3
    heuristics (scope, spec adherence, constraint, dependency, risk, doc)
    and writes SIDEKICK comments to flag any gaps.
3. **Drift detection:** When aki-main output diverges from any spec field, route
   to a failure report — do not silently accept. Spec drift is the canonical
   definition of misalignment.

### Phase REPLAN — Spec-Driven Recovery

1. Triggered by a blocking failure (severity = `blocking` or `high`).
2. **Do NOT change the spec.** Change the plan. The spec is the constraint;
   the plan is the path. If aki-main hit a wall, the path was wrong — not
   the destination.
3. Exception: if the failure reveals a spec ambiguity, classify it as
   `plan_quality` (see critique-fault-taxonomy skill) and escalate to the human
   rather than silently revising the spec.

**Sidekick observation:** aki-sidekick detects spec drift by comparing aki-main's
outputs against the evolving plan and todo. When aki-main's output contradicts
the spec or plan without an explicit replan trigger, aki-sidekick writes a
SIDEKICK comment flagging the drift with `action: review`. If aki-main silently
revises the spec rather than escalating a `plan_quality` ambiguity, that is a
`role_deviation` (see critique-fault-taxonomy).

### Phase REALIGN — Human Redirect

1. Triggered by human redirect mid-execution. The human says "actually, do X
   instead" or "don't touch Y after all."
2. aki-main bumps `spec.version` and applies the human's change to the spec
   fields.
3. aki-main writes a realignment note (as a decision log entry or SIDEKICK
   comment) explaining what changed, why, and which downstream tasks are affected.
4. Gate: human **re-approval** of the revised spec before aki-main resumes.
   The spec has changed — the human must confirm the new version with the
   same rigor as the original approval.
5. aki-main logs the decision:
   ```yaml
   - id: "D-005"
     phase: REALIGN
     decision: "spec revised per human redirect — cache now uses local storage only"
     rationale: "human decided Redis is out of scope for v1; removed Redis constraint"
     timestamp: "2026-06-06T11:30:00Z"
     made_by: human
   ```

**Sidekick observation:** aki-sidekick verifies that the spec version was
bumped on realignment and that downstream tasks were updated to reflect the
change. If downstream tasks still reference the old spec, aki-sidekick writes
SIDEKICK comments to flag the stale dependencies.

---

## Decision Log Discipline

Every phase transition, human override, and material spec change gets one
entry. The decision log is append-only, ADR-style.

### Entry fields

```yaml
decision_log:
  - id: <auto-increment string, e.g. "D-001">
    phase: <ELICIT | SPEC | PLAN | EXECUTE | REPLAN | REALIGN | REVIEW | DONE>
    decision: <what was decided — one sentence>
    rationale: <why — 2–3 sentences>
    timestamp: <ISO 8601>
    made_by: aki-main | human
```

### Rules

- **Append-only.** Never delete or rewrite existing entries.
- **If a decision is reversed,** write a new entry referencing the old one:
  `supersedes: D-003`. Do not edit D-003.
- **aki-main-made decisions** are provisional — the human can override them.
  A `made_by: aki-main` entry means "aki-main chose this path given the
  information at the time." An override is a new entry with `made_by: human`.
  aki-sidekick observes these decisions and flags when aki-main overrides a
  prior decision without logging the reversal.
- **Every log entry is context for aki-main.** When packaging a subtask,
  include ≤3 most relevant decision log entries in aki-main's context.

---

## Version Bumping Rules

Increment `spec.version` on:

| Change                                         | Example                                     |
| ---------------------------------------------- | ------------------------------------------- |
| Human approval of draft spec                   | version 1 → 2 (first revision)              |
| Human realignment mid-session                  | version 2 → 3                               |
| Any change to `objective`                      | version 3 → 4                               |
| Any change to `constraints`                    | version 3 → 4                               |
| Any addition or removal of `non_goals`         | version 3 → 4                               |
| Any change to `success_criteria`               | version 3 → 4                               |

Do NOT increment on:

- Typo fixes
- Reformatting (whitespace, ordering)
- Adding a new `open_question` to the uncertainty ledger (not a spec change)
- Updating the `task_graph` (that's the plan, not the spec)

---

## Contrast: One-Shot Spec vs Living Spec

| Dimension            | One-shot spec (create-specification) | Living spec (this skill)           |
| -------------------- | ------------------------------------ | ---------------------------------- |
| Write frequency      | Once, committed, immutable           | Seeded once, evolves all session   |
| Versioning           | None                                 | Version counter on every change    |
| Decision tracking    | None                                 | ADR-style log for every transition |
| Realignment          | Not supported                        | Realignment notes + re-approval    |
| Storage              | Standalone file in `/spec/`          | Integrated into aki-main's session metadata|
| Audience             | Designed for AI consumption only     | Designed for human + AI shared use |
| Ambiguity handling   | Filled silently                      | Surfaced as open questions         |

Do NOT use the one-shot pattern for specs — it produces a spec that rots
after the first realignment. The living spec (maintained in aki-main's
evolving plan) is designed to survive the session's inevitable course
corrections.

---

*Living spec discipline — maintain the spec as evolving, versioned, shared source of truth across the session.*
