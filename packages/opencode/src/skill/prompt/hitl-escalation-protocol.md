# HITL Escalation Protocol — aki-sidekick

## Overview

This skill defines when and how the sidekick surfaces human decisions during
autonomous coder execution. HITL (human-in-the-loop) is expensive — every
interrupt costs the human's attention and the coder's momentum. Use it only
when necessary.

**Core principle:** Default mode is human-on-the-loop (HOTL). The coder runs
autonomously within a checkpoint window. The sidekick accumulates observations.
The human is informed at scheduled checkpoints. HITL is a triggered interrupt
— the coder pauses, the human must decide, then the coder resumes.

### Gap skill

The skills.sh registry has no HITL escalation skill for agent systems. The
closest is `requesting-code-review` (severity tiers) — but those tiers are
for code-review feedback categorization, not for interrupting autonomous
agent execution. This skill is genuinely novel: trigger taxonomy,
auto-escalation thresholds, interrupt formatting, uncertainty accumulation
across the session, and the HOTL-vs-HITL distinction.

### Agent ownership

In the 4-agent sidekick model, **the parent aki-sidekick agent owns the
HITL role.** This skill is loaded primarily by the parent to evaluate
triggers, maintain the uncertainty ledger, and format interrupts. The
child agents (aki-sk-spec, aki-sk-watch, aki-sk-report) feed observations
and reports to the parent; the parent decides whether to escalate.

### Spec invariants enforced

- **P3 (human-on-the-loop, not human-in-every-step):** The HOTL vs HITL distinction and three-tier taxonomy enforce "surface only what requires human steering"
- **§9 (escalation and HITL protocol):** Direct implementation of the entire §9 — trigger taxonomy, thresholds, interrupt format, and auto-escalation

---

## The Three-Tier Trigger Taxonomy (sidekick-spec §9.1)

### TIER 1 — Hard Interrupt

**Coder MUST pause before proceeding.** The human MUST respond before the
coder continues.

Triggers (any ONE of these fires Tier 1):

- **Action is irreversible.** Deploy, delete, external API mutation, database
  schema change, file system destructive operation.
- **Action touches scope outside the approved boundary.** The coder's pending
  or just-completed action writes to files in `do_not_touch` or outside
  `scope_boundary`.
- **Coder expresses its own uncertainty.** The coder says "I'm not sure if...",
  "I think this should work but...", or asks a question the spec should have
  answered.
- **Accumulated uncertainty severity = high** on the current node. The
  uncertainty ledger has at least one `high` severity item linked to this
  task node.

Behavior: Coder pauses. Sidekick prepares interrupt content. Human must choose
before coder proceeds.

### TIER 2 — Soft Interrupt

**Coder continues current subtask.** Human is notified at the next exchange
but is not required to respond before the coder proceeds.

Triggers (any ONE):

- **Spec criterion cannot be evaluated from current output.** The coder's
  output is ambiguous — neither clearly passing nor clearly failing the
  `success_signal`. The human should decide whether it passes.
- **Output introduces a new dependency** not in the task graph. The coder's
  work creates an implicit dependency on something not yet built. Downstream
  nodes may be affected.
- **Observation changes risk profile of a downstream node.** A new risk flag
  is discovered that wasn't in the original plan inspection.
- **Two consecutive subtasks produce out-of-spec output.** A pattern of drift
  is forming — the human should be aware even if neither individual failure
  was blocking.

Behavior: Coder continues. Human sees the interrupt at the next exchange;
can interject but doesn't have to.

### TIER 3 — Batch

**No interrupt.** Collected for the next scheduled checkpoint or progress
report.

Triggers:

- Style or convention observations (missing docstrings, naming deviations)
- Documentation gaps (public interface lacks doc, README outdated)
- Non-blocking alternative approaches (the coder's way works; another way
  might be better)
- Completed TODO items that need human acknowledgement (not action)

Behavior: No interrupt. Items are batched into the next progress report.
Human reads at their convenience.

---

## Auto-Escalation Thresholds (sidekick-spec §9.3)

The sidekick monitors the uncertainty ledger continuously. When the ledger
crosses a threshold, escalation fires automatically — no human trigger needed.
The thresholds are configurable; start with these defaults and tune based on
human feedback.

| Condition                      | Threshold | Action                         |
| ------------------------------ | --------- | ------------------------------ |
| `high_severity_items`          | ≥ 1       | Immediate HITL (Tier 1)        |
| `medium_severity_items`        | ≥ 3       | Soft interrupt (Tier 2)        |
| `any_severity_items` (total)   | ≥ 5       | Early checkpoint (batch delivery) |

### Threshold tuning

If the human consistently dismisses Tier 1 interrupts on a particular trigger
type (e.g., "scope boundary touch" when the human always says "proceed as
planned"), relax that threshold by adding it to a suppression list:

```yaml
auto_escalate_suppress:
  - trigger: scope_boundary_touch
    reason: "human consistently approves these — relaxing to Tier 2"
    effective_until: next_session
```

Do NOT suppress without human acknowledgement. The first suppression requires
a decision log entry; subsequent suppressions of the same trigger can be
automatic.

---

## Interrupt Format (sidekick-spec §9.2)

When a Tier 1 or Tier 2 interrupt fires, prepare content using this exact
format:

```
## Action Required — <ISO 8601 timestamp>

**why interrupted:** <one sentence — the specific condition that fired>

**context:**
  current phase:   <ELICIT | SPEC | PLAN | EXECUTE | REPLAN | REVIEW>
  pending action:  <what the coder is about to do or just did>
  reversibility:   irreversible | reversible
  blast radius:    <files, systems, or downstream tasks affected>

**options:**
  A) proceed as planned
  B) <alternative with different scope/approach>
  C) defer — I will review [artifact] and resume manually

**question:** Which option do you choose? (A / B / C)
```

### Rules for each field

**Option A** must always be available. It represents the human's original
plan — the default path. Removing it removes agency.

**Option B** must be a concrete, actionable alternative. Not "do something
else" — a specific different scope, approach, or constraint. Example:
"Scope down to `src/cache/` only, deferring `src/auth/` integration to a
separate task."

**Option C** must reference a specific artifact the human can review before
deciding. Example: "Defer — I will review the revised spec at
`sidekick-context/spec.yaml` and resume manually."

**Never continue past a Tier 1 interrupt without explicit human choice.**
If the human's response is ambiguous (e.g., "maybe" or "let me think"),
re-ask with clarification — never guess the intent.

**Blast radius** — list what this action affects. Files changed, systems
touched, downstream tasks that would need revision. Be specific: not
"the codebase" but "`src/cache/client.py`, `src/cache/__init__.py`, and
task T4 (rate limiter integration) which depends on the cache interface."

---

## Uncertainty Ledger Discipline

The uncertainty ledger (in `sidekick-state.yaml`) is the persistent record
of every uncertain observation across the session. It drives auto-escalation.

### Ledger entry fields

```yaml
uncertainty_ledger:
  - item: "Cache client imports redis but spec says 'Redis not in test env'"
    severity: high
    source: coder_output
    status: escalated
    linked_task: T3
    timestamp: 2026-06-06T14:22:00Z
```

- `item` — specific, one observation per entry. "The code is messy" is not
  an item. "`src/cache/client.py:42` calls `redis.get()` without error
  handling, violating spec criterion #3" is an item.
- `severity` — `low | medium | high`. Severity is determined by the taxonomy
  and report format (see xai-failure-report skill). Do not guess.
- `source` — `coder_output | spec | human_input`. Where did the uncertainty
  originate?
- `status` — `open | escalated | resolved`.
- `linked_task` — which task graph node this item relates to (for context
  when the human reviews the ledger).

### Resolution rules

- Mark `resolved` ONLY when the human explicitly acknowledges or overrides.
- Do NOT auto-resolve. The sidekick cannot close a human uncertainty.
- When resolved, add a `resolution_note` field: what the human decided.
- If an item is escalated (status: `escalated`), it must have a corresponding
  interrupt or decision log entry referencing it.

### Ledger lifecycle

```
  observation  →  write to ledger (status: open)
                      │
                      ▼
  auto-escalate? ── yes ──► status: escalated → interrupt to human
                      │
                      no
                      │
                      ▼
  status: open (accumulate for next checkpoint)
                      │
                      ▼
  human acknowledges or overrides → status: resolved
```

---

## Human-on-the-Loop (HOTL) vs Human-in-the-Loop (HITL)

This distinction is critical — do not mix the two modes.

### HOTL (default operating mode)

- Coder runs autonomously within a checkpoint window.
- Sidekick accumulates observations in the uncertainty ledger.
- Sidekick writes progress reports at scheduled intervals.
- Human is informed at checkpoints — but does not need to respond.
- The coder does not pause. Momentum is preserved.

When the human reads a HOTL progress report, the footer says
`[no human action required]` unless a flag requires attention.

### HITL (triggered interrupt mode)

- A Tier 1 or 2 trigger fires.
- Coder pauses (Tier 1) or continues with notification (Tier 2).
- Sidekick prepares structured interrupt content.
- Human must actively decide before the coder resumes.
- Momentum is broken — the cost must be justified by the stakes.

HITL is for **decisions**, not for **updates**. If the human doesn't need to
choose, it's not HITL — batch it into HOTL.

### Examples of the distinction

| Situation                               | Mode | Why                                                       |
| --------------------------------------- | ---- | --------------------------------------------------------- |
| Coder completed 3 of 7 tasks            | HOTL | Progress update — no decision needed                      |
| Coder is about to delete a database     | HITL | Irreversible action — human must authorize                |
| Coder wrote a function with poor naming | HOTL | Style observation — batch into progress report            |
| Coder's output doesn't match spec       | HITL | Alignment drift — human must decide to accept or redirect |
| Coder added a new dependency            | HITL | Risk profile change — human should be aware               |
| Coder left a TODO comment               | HOTL | Minor — acknowledge at checkpoint                         |

---

## When NOT to Escalate

- **Observations the spec already accounts for.** If the spec says "no Redis
  in test," and the coder avoided Redis, that's spec compliance — not an
  observation. Don't escalate compliance.
- **Observations too granular for the human to act on.** A missing blank line
  or a variable name that could be slightly better — the human cannot usefully
  act on these. Batch or drop.
- **Complaints without a proposed resolution.** Run through the reflexion
  pipeline (see reflexion-pipeline skill) before considering escalation.
  If you can't propose what to do about it, don't surface it.
- **Duplicate observations** already in the uncertainty ledger. Check the
  ledger before writing a new entry.

---

*References: sidekick-spec §3.3 (HOTL vs HITL), §9 (escalation protocol); sidekick-custom-skills §2.4*
