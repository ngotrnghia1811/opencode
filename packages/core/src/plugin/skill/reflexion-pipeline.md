# Reflexion Pipeline — Internal Critique Before Surfacing

## Overview

The reflexion pipeline is the sidekick's internal quality filter. Before any
observation, suggestion, or report reaches the human, it passes through a
self-critique loop that eliminates noise, sharpens actionability, and ensures
only what requires human attention is surfaced.

**Core principle:** The human should see only what they need to act on.
Everything else is the sidekick's problem to resolve internally.

### Derivation

Adapted from `receiving-code-review` (obra/superpowers) — the "verify before
implementing, push back on wrong suggestions" pattern, inverted from *receiving*
critique to *producing* it. Combined with `systematic-debugging` (obra/superpowers)
— the "investigate before fixing" discipline, applied to "critique your own
observation before surfacing it."

No registry skill teaches a structured self-critique loop. This is a distinct
cognitive pattern: generate → critique → revise → present. It is not "verify
your work" — it is "generate a critique, then critique your own critique, then
revise, then present only what survives."

### Spec invariants enforced

- **P3 (human-on-the-loop):** The reflexion filter enforces "surface only what requires human steering"
- **P7 (conversational framing):** The revise step enforces Socratic questioning before presentation
- **Internal reflexion:** Direct implementation of the reflexion pipeline

---

## The Three-Step Loop

```
  generate  →  critique  →  revise  →  present (or batch)
```

Every observation the sidekick produces runs through these steps. The pipeline
is not optional — it is the mechanism that prevents the human from being flooded
with low-value observations.

---

### Step 1 — Generate

Produce an initial, raw observation from aki-main's output or a state change.
This is unfiltered — capture what you see without self-editing. The critique
step will filter it.

The raw observation should capture:

- **What happened** — the event or output from aki-main
- **Where** — file paths, line ranges, tool call
- **The divergence** (if any) — what differs from the spec, plan, or expectation

Example raw observations:
- "Aki-main modified `src/auth/secrets.py` — outside scope_boundary `src/cache/*`."
- "Aki-main imported `redis` but spec says 'Redis not available in test environment.'"
- "The diff at `src/cache/__init__.py` has no module docstring."
- "Aki-main's output satisfies success_signal but uses a fixed window where a sliding window would better fit p99 latency constraint."

Raw observations are internal. They do not reach the human.

---

### Step 2 — Critique

Apply the reflexion filter. Ask these five questions for each observation:

#### Is this accurate?

Verify against evidence. Can you cite the file path, line range, or diff that
proves this observation? If not, the observation is a hunch — drop it or
investigate further.

- Check: "Can I cite a specific file + line for this claim?"
- Drop if: you cannot. "The code seems messy" is not an observation.
- Example: The observation about `src/auth/secrets.py` → verified by the diff
  from aki-main's last turn. ✓ accurate.

#### Is this necessary?

Would the human act on this, or is it noise? The human's attention is not
free — every observation costs attention. If the observation won't change
a decision, it's noise.

- Check: "If the human reads this, will they change direction, approve a
  deviation, or clarify the spec?"
- Drop if: the human would read it and say "ok" with no action.
- Example: Missing docstring → the human probably won't change direction over
  it. ⚠ borderline — batch, don't escalate.

#### Is this novel?

Has the spec already accounted for this? If the spec says "docstrings are
optional" and the observation is "no docstring," the observation is redundant
— the spec already covered it.

- Check: "Does the spec, decision log, or uncertainty ledger already address
  this exact observation?"
- Drop if: yes, and no new information has emerged.
- Example: Aki-main didn't write docstrings, and spec says "docstrings are
  nice-to-have." Not novel → drop or batch as a note.

#### Is this actionable?

Does the observation include a proposed resolution? A complaint without a
proposal is a burden on the human. Either revise to include one, or drop.

- Check: "Can I say 'the human should do X' about this observation?"
- Drop if: you cannot propose a specific action.
- Example: "The code could be faster" → not actionable (what metric? what
  target? what change?). Drop or revise.

#### Is this a duplicate?

Is this observation already in the uncertainty ledger? Check the ledger
before writing a new entry.

- Check: "Does the uncertainty ledger already have an item matching this?"
- Drop if: yes, and the ledger entry is still `open` or `escalated`.
- Example: The same scope-boundary violation observed twice → already in
  ledger. Don't re-add.

### The critique filter summary

| Filter       | Question                                | Drop if…                                  |
| ------------ | --------------------------------------- | ----------------------------------------- |
| Accurate?    | Can I cite evidence?                    | Cannot cite a specific file/line/spec     |
| Necessary?   | Would the human act on this?            | Human would read it and do nothing        |
| Novel?       | Has the spec already accounted for it?  | Already addressed in spec or decision log |
| Actionable?  | Can I propose what the human should do? | Complaint without a proposed resolution   |
| Duplicate?   | Already in the uncertainty ledger?      | Same item exists with status open/escalated|

---

### Step 3 — Revise

For observations that survive the critique filter, rewrite them for human
consumption:

#### Remove noise

Strip raw traces, agent turn numbers, internal state, and implementation
details the human doesn't need. The human receives the observation — not
the sidekick's working notes.

- Before: "Aki-main at turn 7 called `write_file` targeting `src/cache/__init__.py`
  and the diff shows lines 1-15 with no docstring. The internal state
  had `current_task: T3` and `phase: EXECUTE`."
- After: "`src/cache/__init__.py` has no module docstring."

#### Sharpen the action

Every observation that reaches the human must include "what the human should
do about this":

- Approve — "This is acceptable as-is."
- Redirect — "Do X instead."
- Clarify — "Should we do X or Y?"
- Acknowledge — "Noted; no action needed."

- Before: "Aki-main used a fixed window for the rate limiter."
- After: "The rate limiter uses a fixed window. Given the p99 latency
  constraint, burst spikes may occur at window boundaries. Is this
  acceptable, or should I flag it for revision to a sliding window?"

#### Frame conversationally

Use Socratic questioning rather than declarative conclusions. See the
critic-not-judge-stance skill for framing patterns.

- Not: "The rate limiter is wrong."
- Yes: "The rate limiter uses a fixed window. Given your p99 latency
  constraint, that may cause burst spikes at window boundaries. Is that
  acceptable, or should I flag this for aki-main to revise?"

#### Batch low-stakes items

Observations that don't require immediate human action → batch into the
next progress report. Don't surface them as individual items.

- "`src/cache/__init__.py` lacks module docstring. Non-blocking." → batch
- "`src/cache/client.py:42` calls `redis.get()` without error handling,
  violating spec criterion #3. This will fail CI." → present immediately

---

### Step 4 — Write (or Batch)

Write the revised observation as a SIDEKICK comment into the relevant
project file. Use the appropriate `action` level:

- **`block`** — irreversible action, scope violation, or spec noncompliance
  that should halt further work. Aki-main must not proceed past this comment
  without resolution.
- **`review`** — new risk, ambiguous spec criterion, or tradeoff worth the
  human's attention. The comment flags the issue but does not halt execution.
- **`none`** — style observation, non-blocking alternative, or documentation
  gap. Batched or appended as a note.

TIER 1 observations → `SIDEKICK(block)`
TIER 2 observations → `SIDEKICK(review)`
TIER 3 observations → batch into progress report or write as `SIDEKICK(none)`

The reflexion pipeline produces the revised content; aki-sidekick writes it
directly into the project as a solo observer. No parent interrupt mechanism
is involved.

---

## Worked Example: Two Observations, One Pipeline

### Raw observation 1

"The diff at `src/cache/__init__.py` has no module docstring."

**Critique:**
- Accurate? ✓ (verified: file exists, no docstring in lines 1-15)
- Necessary? ⚠ (docstring is a style convention, not a spec constraint)
- Novel? ✓ (not in the spec — spec doesn't mandate docstrings)
- Actionable? ⚠ (human doesn't need to act on a missing docstring)
- Duplicate? ✗ (not in ledger)

**Revise:**
- Remove noise: strip the turn info, keep the file path.
- Sharpen action: human action = acknowledge (not act).
- Downgrade to TIER 3 (style observation).
- Batch into progress report as: `[obs] src/cache/__init__.py lacks module
  docstring. Non-blocking.`
- Do NOT surface as a separate interrupt.

### Raw observation 2

"Aki-main imported `redis` in `src/cache/client.py:3` but spec constraint
#2 says 'Redis not available in test environment' — this will fail CI."

**Critique:**
- Accurate? ✓ (verified: import at line 3, spec constraint #2 confirmed)
- Necessary? ✓ (will block CI — human MUST act)
- Novel? ✓ (spec constraint violation — not previously observed)
- Actionable? ✓ (aki-main must remove or guard the import; human must decide
  whether to relax the constraint or enforce it)
- Duplicate? ✗ (not in ledger)

**Revise:**
- Upgrade to TIER 1 (constraint violation = potential blocking failure).
- Sharpen action: human must decide — accept Redis import (relax constraint)
  or reject it (enforce constraint).
- Frame conversationally: "Aki-main imported `redis` at
  `src/cache/client.py:3`. Spec constraint #2 says Redis is not available
  in the test environment. If this stays, tests will fail. Options: (a) accept
  the import and update the test environment, (b) have aki-main guard the
  import behind an environment check, (c) defer — I'll review what else depends
  on Redis and come back. Which do you choose?"
- Write as a SIDEKICK(block) comment into `src/cache/client.py`.

---

## When NOT to Run the Reflexion Pipeline

- **Deterministic heuristic pass (all green).** If aki-sidekick's observation
  checks are all green, there are no observations to reflex on. Skip the
  pipeline entirely.
- **Explicit human request for raw output.** If the human says "show me the
  logs" or "give me the raw traces," bypass reflexion and deliver as-is.
  The human wants the unfiltered view — honor that.
- **During ELICIT phase (Mode 1 questions).** The pipeline is for observations,
  not for the clarifying-question ritual. Elicitation questions go directly
  to the human; they don't need self-critique because the human is actively
  shaping the spec in that phase.

---

*Reflexion pipeline — internal critique before surfacing — part of the aki-sidekick observation workflow*
