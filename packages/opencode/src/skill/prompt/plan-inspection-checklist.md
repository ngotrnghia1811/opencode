# Plan Inspection Checklist

## Overview

Plan inspection is the sidekick's highest-leverage critique moment. A bad plan
fails the entire trajectory — not at the first bug, but at the first tool call.
Aki-main will faithfully execute a bad plan; it cannot detect that the plan
itself is flawed.

**Core principle: DO NOT RELEASE AN UNINSPECTED PLAN.** Every plan, whether
newly generated or replanned from a failure node, must pass all seven inspection
dimensions before reaching the human or aki-main.

### Derivation

Adapted from `planning-and-task-breakdown` (addyosmani/agent-skills) for task
decomposition methodology, and `verification-before-completion` (obra/superpowers)
for evidence-backed claims. The registry skill teaches how to *decompose* work
into tasks; this skill teaches how to *inspect* the decomposition against seven
quality dimensions for plan inspection.

### Spec invariants enforced

- **P5 (spec as shared source of truth):** Inspection verifies plan completeness against the spec — the spec is the standard
- **Plan inspection:** Direct implementation of the plan inspection dimensions

---

## The Seven Inspection Dimensions

Run this checklist on EVERY plan. If any dimension fails, revise internally
before presenting. If completeness or risk coverage fails, surface to the
human as a question — do not silently fix.

### 1. Completeness

**Question:** "Does the plan cover all spec success criteria?"

**Check:**
- For each `success_criterion` in the spec, verify ≥1 task node explicitly
  addresses it.
- Map criteria → task nodes. Produce a coverage table:
  ```
  criterion #1: "p99 latency < 5ms"          → T3 (cache implementation), T5 (benchmark)
  criterion #2: "fallback to DB on failure"   → T4 (fallback logic)
  criterion #3: "no Redis in test env"        → T6 (test config)
  ```
- Flag any uncovered criteria. If criterion #4 has no task node → fail.

**Fail action:** Add missing task nodes to cover uncovered criteria. If the
spec itself is ambiguous about what coverage means, escalate to human:
"Success criterion #4 states 'responsive UI.' I need clarification on what
responsiveness threshold to test against."

### 2. Feasibility

**Question:** "Are subtasks achievable within the stated constraints?"

**Check:**
- For each task node, verify it does not require resources, tools, or
  permissions outside aki-main's toolset.
- Can aki-main actually execute this? Does it need a database that doesn't
  exist? A library that isn't installed? A tool the toolset excludes?
- Check for implicit dependencies: if T5 says "deploy to staging," does
  aki-main have deploy credentials?

**Fail action:** Flag infeasible nodes. Propose either:
- Scope reduction: remove the infeasible part
- Tool expansion: grant aki-main the needed capability (requires human approval)
- Decomposition: split the node into feasible sub-steps, flagging the infeasible
  part for the human

### 3. Risk Coverage

**Question:** "Are high-risk nodes identified and gated?"

**Check:** For each task node:
- Assess risk flags. Nodes that mutate state, touch external systems, or have
  irreversible effects are high-risk.
- High-risk nodes MUST have `checkpoint_next` set — the human must review
  before aki-main starts that node.
- Verify risk flags are not missing: a node named "delete all test data" with
  no risk flags → fail.

**Fail action:** Add `risk_flags` and `checkpoint_next` to unflagged high-risk
nodes. If unsure whether a node is high-risk, flag it — false positive is
safer than false negative.

### 4. Dependency Validity (DAG)

**Question:** "Do dependencies form a valid DAG with no cycles or orphans?"

**Check:**
- Perform a topological sort on the task nodes using `depends_on` edges.
- Detect cycles: if topological sort fails, a cycle exists.
- Detect orphans: nodes with no incoming edges that are NOT the first node.
- Detect leaves: nodes with no outgoing edges that are NOT the last node.
- Verify every dependency is defined: if T4 `depends_on: [T7]` and T7 doesn't
  exist → fail.

**Fail action:**
- Cycles → replan to break the cycle. Identify the circular dependency and
  restructure: merge the cyclic nodes, add an intermediate node, or reorder.
- Orphans → add dependency edges to connect them, or if genuinely independent,
  document as a parallel track (add `parallel: true` flag).
- Missing dependencies → create the missing node or correct the reference.

### 5. Scope Hygiene

**Question:** "Is each node's `scope_boundary` specific enough?"

**Check:**
- Every task node must have an explicit `scope_boundary` — a list of files
  or directories aki-main may touch.
- Every task node must have an explicit `do_not_touch` — files or directories
  aki-main must not touch, even if they're adjacent to the scope.
- Boundaries must be at file or directory level, not "the whole project" or
  "the src folder" (too broad — invites scope creep).
- `do_not_touch` must include adjacent modules aki-main might accidentally
  touch: if scope is `src/cache/*`, `do_not_touch` should list `src/auth/`,
  `src/db/`, etc.

**Fail action:** Add missing `scope_boundary` and `do_not_touch` to
underspecified nodes. A node without a scope boundary is a blank check —
aki-main can touch anything. Reject it.

### 6. Ambiguity

**Question:** "Can each subtask's `success_signal` be evaluated unambiguously?"

**Check:** For each task node, read the `success_signal`. Apply the "two
implementations test":

> Can two different implementations both satisfy this success_signal while
> one meets the human's intent and the other does not?

If yes → the signal is ambiguous.

Examples:
- ✗ "Implement caching" — in-memory cache vs Redis cache both satisfy
- ✗ "Improve performance" — no metric to test against
- ✗ "Add error handling" — what errors? what handling?
- ✓ "File `src/cache/client.py` exists with function `get(key: str) -> bytes`
  that returns cached value or raises `CacheMissError`"
- ✓ "Benchmark shows p99 cache read latency < 5ms under 5000 req/s"

**Fail action:** Rewrite ambiguous success_signals with testable criteria.
If the spec itself is ambiguous about what success looks like, escalate to
the human — do not invent a specific signal from a vague spec.

### 7. Sequencing

**Question:** "Is the ordering logical given the dependencies?"

**Check:**
- When dependencies are satisfied, does the execution order minimize context
  switches? Aki-main should not bounce between unrelated modules.
- Are independent tasks parallelizable? Mark them `parallel: true` where safe.
- Are high-risk tasks placed early (fail-fast) or late (de-risk first)?
  Either is valid — the rationale must be explicit.
- Does the sequence respect the spec's constraints? If spec says "don't touch
  auth module until week 2," auth-related tasks must come after that gate.

**Fail action:** Reorder nodes for optimal sequencing. Document the rationale
in a decision log entry:

```yaml
- id: "D-004"
  phase: PLAN
  decision: "reordered tasks T5 and T6 — placing cache benchmark (T6) before
            API integration (T7) to fail fast on performance issues"
  rationale: "catching performance regressions early avoids rework on the
             integration layer"
  timestamp: "..."
  made_by: aki-main
```

### Sequencing heuristics

| Task type            | Placement                                              |
| -------------------- | ------------------------------------------------------ |
| Core interfaces      | Early — everything depends on them                     |
| High-risk mutations  | Early with checkpoint — fail fast on the scariest part |
| Performance-sensitive| Early — benchmark before building on a slow foundation |
| Documentation        | Late — doc what was built, not what you plan to build  |
| Polish / style       | Last — don't polish code that will change              |

---

## Inspection Output

After running all seven dimensions, produce a summary:

```
Plan Inspection — <timestamp>

✓ dimensions passed:
  - feasibility (all nodes within aki-main toolset)
  - dependency validity (DAG, no cycles, 0 orphans)
  - sequencing (fail-fast ordering with rationale logged)

⚠ dimensions revised internally:
  - scope hygiene: added do_not_touch to T3, T4, T5
  - ambiguity: rewrote success_signal for T2 (was "add caching," now testable)

✗ dimensions escalated to human:
  - completeness: success criterion #4 ("responsive UI") has no covering
    task node. Question: what responsiveness threshold should I test against?
  - risk coverage: node T7 ("deploy to staging") is high-risk but lacks
    checkpoint_next. Should I add a human gate before deploy?
```

If all dimensions pass (✓ only) → the plan is ready for human approval.
If any dimension is escalated (✗) → present the plan AND escalation questions
together — the human needs both to make a decision.

---

## When NOT to Inspect Fully

- **Single-task plans** (one node, no dependencies). Run completeness and
  feasibility only — the other dimensions are N/A.
- **Incrementally updated plans** already inspected this session. Re-inspect
  only the changed nodes and their direct dependency edges. If the change
  is purely additive (new node appended to the end), inspect the new node
  and verify no cycles were introduced.
- **Emergency replans** triggered by a blocking failure where the human has
  explicitly said "just fix the scope and retry." Perform scope hygiene
  and ambiguity only — skip the full seven dimensions.

---

*Plan inspection dimensions — apply before any plan reaches aki-main.*
