# Critique Fault Taxonomy — opencode Agent Diagnostics

## Overview

This skill teaches a six-category fault taxonomy for opencode coder agents.
Every failure or anomaly the watcher detects must be classified into one of
these six categories before reporting or recovering. The core principle:
**category determines recovery.** Misclassifying a failure leads to the wrong
recovery action — the wrong fix is worse than no fix.

### Derivation

Adapted from `systematic-debugging` (obra/superpowers) for root-cause-first
discipline, and `five-whys-analysis` (ddunnock/claude-plugins) for the
iterative causal-questioning method. These are layered: `systematic-debugging`
provides the diagnostic mindset; this skill adds the six opencode-agent-specific
categories and the category→recovery mapping the registry skill lacks.

### Spec invariants enforced

- **P2 (non-effect outputs only):** The taxonomy produces a classification, not a fix. Recovery paths are recommendations routed to the human or parent — never executed by the sidekick.
- **§8.4 (failure classification):** Direct implementation of the failure taxonomy table from sidekick-spec §8.4.

---

## The Six-Category Taxonomy (sidekick-spec §8.4)

### 1. initialization

**Definition:** Failure before the first meaningful action. The agent could
not start the subtask due to context parse errors, tool setup failures, or
missing configuration.

**Signal pattern:**
- Error occurs in the first 1–3 turns of a subtask.
- No files were modified.
- Error message indicates a setup or config problem, not a logic problem.

**Default recovery:** Retry with cleaned context. Do not replan — the plan
may be sound; the context was bad.

**Diagnostic question:** "Did the agent successfully start the subtask?"

**Example:** Coder receives a subtask context with a malformed YAML field.
Fails on context parse at turn 1. Classification: `initialization`. Recovery:
fix the context packaging and retry.

---

### 2. role_deviation

**Definition:** Coder acts outside its defined scope. It writes files outside
`scope_boundary`, performs actions not in the task spec, or assumes permissions
it does not have.

**Signal pattern:**
- Diffs touch files in the `do_not_touch` list.
- Tool calls target unauthorized paths.
- Bash commands mutate state not described in the plan.
- Coder performs "bonus work" not requested in the subtask.

**Default recovery:** Scope-restrict and re-run. Update the subtask context
with tighter boundaries.

**Diagnostic question:** "Did the agent stay within its assigned scope?"

**Example:** Coder's scope_boundary is `src/cache/*` but it writes to
`src/auth/secrets.py`. Classification: `role_deviation`. Recovery: re-run
with explicit `do_not_touch: [src/auth/]`.

---

### 3. memory_state

**Definition:** Context window saturation, state desynchronization between
`sidekick-state.yaml` and the coder's working memory, or hallucinated
constraints the coder invented rather than read from the spec.

**Signal pattern:**
- Coder repeats earlier work it already completed.
- Coder contradicts a prior decision recorded in the decision log.
- Coder references files that don't exist (hallucinated paths).
- Coder forgets constraints that were given 3+ turns ago.
- Coder's output no longer matches the subtask's `success_signal`.

**Default recovery:** Repackage context, fresh handoff. Discard the coder's
current working memory and provide a clean context with a compressed decision
log.

**Diagnostic question:** "Is the coder's working memory consistent with
sidekick-state.yaml?"

**Example:** Coder was told 5 turns ago that "Redis is not available in test
environment." It imports `redis` and connects to Redis. Classification:
`memory_state` (forgot constraint). Recovery: repackage context with the
constraint highlighted.

---

### 4. orchestration

**Definition:** Subtask ordering violation, dependency not satisfied before
the dependent task starts, or parallel execution conflict.

**Signal pattern:**
- Coder begins task T4 while T3 (a dependency) is still blocked or in progress.
- Two tasks modify the same file without coordination.
- Coder discovers a missing dependency mid-execution and works around it
  instead of reporting it.

**Default recovery:** Replan from the failure node. Do not re-run the same
task with the same dependencies.

**Diagnostic question:** "Were all dependencies satisfied before this task
started?"

**Example:** Task "implement auth middleware" started before task "define auth
interface." Coder invents its own interface mid-task rather than blocking.
Classification: `orchestration` (dependency violation). Recovery: replan to
reorder tasks.

---

### 5. tool_integration

**Definition:** Tool call failure, schema mismatch, permission error, or API
version incompatibility. The coder's environment cannot support the tool call
it attempted.

**Signal pattern:**
- Tool returns an explicit error code.
- Agent retries the same failing call (loop).
- Agent silently works around the tool failure instead of reporting it.
- Tool output is valid JSON but semantically wrong (wrong version, wrong schema).

**Default recovery:** Inspect tool availability, fix the call parameters, and
retry. If the tool is genuinely unavailable, escalate.

**Diagnostic question:** "Did a tool call fail in a way the agent didn't handle?"

**Example:** Coder calls `run_tests` but the test runner binary is not
installed. Coder retries 3 times with the same command. Classification:
`tool_integration`. Recovery: check if test runner is available; if not,
escalate to human for install decision.

---

### 6. plan_quality

**Definition:** Subtask is underspecified — the `success_signal` is ambiguous
and cannot be evaluated as done/not-done. The failure is in the plan, not in
the coder's execution.

**Signal pattern:**
- Coder completes the task but `success_signal` cannot be evaluated (e.g.,
  "improve performance" — no metric to test against).
- Coder asks clarifying questions that should have been resolved in the spec
  or plan phase.
- Coder produces output that satisfies a literal reading of the spec but
  misses the human's unstated intent.

**Default recovery:** Escalate to human for clarification. Do not guess; do
not revise the spec silently.

**Diagnostic question:** "Could this failure have been prevented by a better
plan node?"

**Example:** Subtask success_signal is "implement caching." Coder implements
an in-memory cache. Human expected Redis-backed. The success_signal was
ambiguous — two different implementations both satisfy it. Classification:
`plan_quality`. Recovery: escalate to human to clarify the caching requirement.

---

## Diagnostic Method: 5 Whys Within the Taxonomy

The taxonomy alone names the category. The 5-Whys method traces the symptom
to the root cause *within that category* — and detects when reclassification
is needed.

### Step-by-step

```
Step 1: Observe the failure signal (from aki-sk-watch heuristic pass).
Step 2: Ask "which category does this signal match?" — use the diagnostic
         questions above to narrow to one category.
Step 3: For the matched category, ask "Why?" iteratively (max 5 times)
         to trace from symptom to root cause.
Step 4: If the root cause crosses into a different category, re-classify
         and continue the 5-Whys in the new category.
Step 5: Map the final root cause to the category's default recovery path.
```

### Worked example

```
Signal: Coder wrote to `src/auth/secrets.py` — outside scope_boundary
        `src/cache/*`.

Step 2 — Classify:
  Diagnostic question: "Did the agent stay within scope?" → No.
  Category: role_deviation.

Step 3 — 5 Whys:
  Why 1: Why did the coder touch `src/auth/secrets.py`?
         → It needed to read auth config to implement cache auth.
  Why 2: Why did it need auth config for a cache task?
         → The cache client uses token-based auth stored in the auth module.
  Why 3: Why wasn't this dependency in the subtask scope?
         → The spec said "cache module" without excluding `src/auth/`.
  Why 4: Why was the scope boundary defined at directory level instead of
         file level?
         → The plan node listed `src/cache/*` as scope but didn't explicitly
         exclude `src/auth/` even though the auth dependency was implicit.

Step 4 — Re-classify:
  Root cause is not role_deviation (the coder followed a reasonable path).
  Root cause is plan_quality — the scope boundary was underspecified.
  Re-classify: plan_quality.

Step 5 — Recovery:
  plan_quality default recovery: escalate to human.
  Question to human: "The cache task needs auth config. Should the scope
  include `src/auth/secrets.py` or should the cache use a separate config?"
```

### When the 5-Whys terminates

Stop the chain when:
- You reach a decision point only the human can make (→ escalate).
- You reach a spec ambiguity that was intentionally left open (→ escalate).
- You reach an environmental constraint the sidekick cannot change (→ report
  with options).
- You have identified a fix the sidekick can apply (→ recommend recovery).

Do not continue past 5 whys — at that depth you are speculating, not diagnosing.

---

## When NOT to Use This Taxonomy

- **When the observation is a deterministic heuristic pass** — all checks
  green, no anomaly detected. No classification needed.
- **When the failure is a known, expected error** with a pre-approved recovery
  path already in the decision log. No re-classification needed — reference
  the prior decision log entry.
- **When the failure is purely environmental** (network timeout, disk full)
  and not specific to agent behavior. These are operational failures, not
  agent faults — handle them with retry logic, not taxonomy classification.

---

*References: sidekick-spec §8.4 (failure classification table); sidekick-custom-skills §2.2*
