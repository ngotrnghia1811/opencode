# XAI Failure Report — Three-Part Structured Format

## Overview

This skill defines the canonical failure report format for aki-sidekick.
When an agent failure is detected and classified, aki-sidekick
produces a structured report that translates raw failure signals into a
human-interpretable explanation with actionable recommendations.

**Core principle:** The human should never need to read logs. The report IS
the translation.

### Derivation

Built from `requesting-code-review` (obra/superpowers) for severity-tier
categorization and `systematic-debugging` (obra/superpowers) for root-cause-first
discipline. Neither registry skill prescribes the specific three-part structure
mandated here: (1) classification with sub-fields, (2) root
cause with evidence citations, (3) recommendation with exactly three options.
This skill fills that format gap.

### Spec invariants enforced

- **P2 (non-effect outputs only):** The report is a non-effect artifact — it never modifies code
- **P6 (bidirectional asymmetric translation):** The translation rules enforce the agent→human expansion direction
- **Failure report format:** The structured format for communicating agent failures to human operators

---

## The Three-Part Structure

Every failure report must follow this exact structure. No additional sections.
No omitted sections.

```
## Failure Report — <task-id> — <timestamp>

### 1. classification
  category:    <initialization | role_deviation | memory_state |
                orchestration | tool_integration | plan_quality>
  severity:    <low | medium | high | blocking>
  pattern:     <known | novel>

### 2. root cause
  summary:     <1-2 sentences in plain language>
  evidence:    <key trace signals with citations>
  contributing_factors: [<list>]

### 3. recommendation
  options:
    a) <retry with constraint: ...>
    b) <replan from node X: ...>
    c) <escalate to human — reason: ...>
  suggested:   <a | b | c>
  rationale:   <why this option>
```

---

## Part 1 — Classification

### `category`
One of the six fault taxonomy categories from the
[critique-fault-taxonomy](#critique-fault-taxonomy) skill. The category must
already have been determined before writing the report — the report records
the classification; it does not perform it.

- `initialization` — failure before first action
- `role_deviation` — agent acted outside scope
- `memory_state` — context saturation or state desync
- `orchestration` — dependency or ordering violation
- `tool_integration` — tool call failure
- `plan_quality` — underspecified subtask

### `severity`

| Level     | Decision rule                                                        |
| --------- | -------------------------------------------------------------------- |
| `blocking`| aki-main cannot proceed without a fix. Execution is stalled.             |
| `high`    | aki-main can proceed, but output is spec-noncompliant.                   |
| `medium`  | Output is spec-compliant but suboptimal (e.g., wrong approach, poor perf). |
| `low`     | Style, convention, or non-blocking alternative approach.              |

Severity determines the escalation tier (see
[hitl-escalation-protocol](#hitl-escalation-protocol)). Blocking and high
severity typically trigger Tier 1 or Tier 2 interrupts. Medium and low are
batched.

### `pattern`
- `known` — this failure matches a pattern previously seen in this session
  or documented in the decision log. A known pattern has a pre-approved
  recovery path — reference it.
- `novel` — this failure has not been seen before. Novel patterns require
  a full report with fresh recommendations. The human cannot rely on
  precedent.

---

## Part 2 — Root Cause

### `summary`
1–2 sentences in plain language. Use vocabulary the human has already used
in this session — no jargon the agent introduced that the human hasn't seen.

Bad: "Unhandled promise rejection in the cache adapter's Redis connection
pool due to missing error boundary in the Effect workflow."
Good: "If Redis is down, the cache will fail instead of falling back to the
database. The fallback code exists but isn't wired in for connection errors."

### `evidence`
Key trace signals with citations. NOT a log dump — selected, annotated
excerpts that tell the story of how the failure was detected.

Every piece of evidence must include a citation in one of these forms:
- `path/to/file.py:42-48` — a file path with line range
- `spec criterion #3: "must fall back to DB on Redis failure"` — a spec reference
- `diff: src/cache/fallback.py line 15 added import redis` — a specific diff change

Evidence must be **sufficient but not exhaustive.** The human should be able
to verify the root cause claim without reading the full codebase, but should
not be buried in detail.

### `contributing_factors`
A list of conditions that enabled the failure. These are not causes themselves;
they are the conditions without which the root cause would not have produced
a failure.

Examples:
- "Scope boundary was defined at directory level, not file level"
- "Redis dependency was implicit in the spec — never explicitly stated"
- "Agent context window exceeded 80% capacity when the failure occurred"
- "Test environment doesn't have Redis, but spec didn't account for this"

Contributing factors inform the recommendation: fixing a contributing factor
may be cheaper than fixing the root cause and equally effective.

---

## Part 3 — Recommendation

### `options`
Exactly three options, labeled (a), (b), (c). Each option must be a concrete,
actionable path — not a vague direction.

- **(a) retry with constraint** — What specific constraint to add? Example:
  "Retry with `scope_boundary: [src/cache/*]` and `do_not_touch: [src/auth/]`
  explicitly listed in the subtask context."

- **(b) replan from node X** — Why is a different plan needed? What node
  to start from? Example: "Replan from node T3. Add a new task node
  'Define auth config interface' before 'Implement cache client'."

- **(c) escalate to human** — What question does the human need to answer?
  Example: "Escalate to human: 'The cache task needs auth config. Should
  the scope include `src/auth/secrets.py` or should the cache use a
  separate config?'"

### `suggested`
aki-sidekick's recommended option: `a`, `b`, or `c`. This is a suggestion;
the human chooses. The suggested option should be the one that best balances
speed, correctness, and risk given what the sidekick knows about the session.

### `rationale`
1–2 sentences explaining why this option over the other two. Cover the
tradeoff: "Option (a) is fastest but may hit the same scope issue on the
next subtask. Option (b) prevents recurrence but adds one task node. I
suggest (a) for this subtask and flag the scope issue for a spec update
before the next cache-related task."

---

## Evidence Citation Discipline

This discipline is mandatory — no exceptions.

- **Every root-cause claim MUST cite** a file path, line range, diff snippet,
  or spec criterion reference. No vague claims.
- **Format:** `path/to/file.py:42-48` or `spec criterion #3: "must fall back
  to DB on Redis failure"`. Use the format consistently.
- **Reject pattern:** "The code doesn't handle errors." (No citation.)
- **Accept pattern:** "The code at `src/cache/fallback.py:15-18` calls
  `redis.get()` without error handling, violating spec criterion #3.
  See also `src/cache/__init__.py:7` where the Redis client is initialized
  without a fallback configuration."

### When you cannot find evidence

If you cannot cite evidence for a claim, the claim is not ready for the
report. Either:
1. Investigate further until you find the evidence.
2. Remove the claim from the report — unsubstantiated claims reduce trust.
3. Reframe the claim as an uncertainty: "I could not confirm whether..."
   (this is a last resort, and only acceptable if the uncertainty itself
   is the point of the report).

---

## Translation Rules

Every technical signal in the report must be translated to plain language
the human can evaluate without reading code.

- **Technical → plain language:** "Unhandled RedisError propagates to caller"
  → "If Redis is down, the request will fail instead of falling back to
  the database."
- **Trace → narrative:** "Stack trace at line 42" → "The error happens when
  the cache client tries to connect to Redis and the connection is refused."
- **Error code → impact:** "Exit code 1 from test runner" → "Two tests failed,
  both in the rate limiter module — the burst threshold test and the reset
  window test."

### Never dump

- Raw stack traces
- Full terminal output (select the relevant lines and annotate)
- Agent turn transcripts (summarize the interaction)
- Complete diffs (cite the relevant lines, not the whole file)
- JSON/YAML blobs the human didn't ask for

If the human needs the raw output, they will ask for it. The report's job is
to make that unnecessary.

---

## When NOT to Produce a Full Report

- **Known pattern with pre-approved recovery.** If this exact failure has
  occurred before and the decision log records the recovery path, produce
  a 1-line reference: `Failure: same as decision_log #12 (tool_integration
  on test runner). Applying approved recovery (retry with `--no-cache`).`
- **Low severity, batched observation.** If the observation is a style or
  convention flag batched into a progress report, produce a single-line flag:
  `[obs] src/cache/__init__.py: no module docstring. Non-blocking.` — not a
  full report.

---

*Structured failure report format for communicating agent failures from aki-sidekick to the human operator.*
