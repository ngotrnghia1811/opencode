> **This is a personal fork of [anomalyco/opencode](https://github.com/anomalyco/opencode).**
> The `dev` branch tracks upstream and adds the features below. `feat/aki-agents` layers the full aki-* agent family — primary wrapper (`aki-main`), Akinator primitives (`aki-clarify`, `aki-judge`, `aki-rank`), the canonical executor (`aki-execute`), and specialists (`aki-research`, `aki-inspector`, `aki-suggest`, `aki-algorithm`, `aki-orchestrator`) — on top.

## Fork-specific features

### `/_switch` — inline mid-session model switching

Type `/_switch <model-or-alias>` in any prompt to swap the active model without starting a new session.

```
/_switch sonnet          # switch to the model whose model_alias is "sonnet"
/_switch anthropic/claude-opus-4-20250514   # switch by provider/model form
```

Configure aliases in `opencode.json`:

```json
{
  "provider": {
    "anthropic": {
      "models": {
        "claude-sonnet-4-20250514": { "model_alias": "sonnet" }
      }
    }
  }
}
```

The switch takes effect on the very next turn and persists for the rest of the session. The original model is restored if you start a new session.

---

### aki-* agent family — built-in reasoning subagents

The fork bundles a family of "aki-" agents, selectable with `Tab` (alongside the upstream `build` / `plan`):

#### Primary agent + Akinator primitives

| Agent | Mode | Purpose |
|---|---|---|
| **aki-main** | primary | Top-level session wrapper. Owns user dialogue, executes directly or delegates to specialists, and synthesises results until you stop. |
| **aki-clarify** | subagent (hidden) | Generalised clarifier primitive. Emits a typed Contract routing to any specialist via `clarify_contract_emit`. |
| **aki-judge** | subagent (hidden) | Generalised judge primitive. Probes a specialist's output against its Contract and emits a typed Verdict via `judge_verdict_emit`. |
| **aki-rank** | subagent (hidden) | Stateless information-gain ranker. Scores candidate items (questions, probes, suggestions) and returns top-K. Called by other primitives. |

#### Specialist subagents

| Agent | Purpose |
|---|---|
| **aki-execute** | Canonical scope-disciplined executor for general implementation work — substantial edits, refactors, docs, multi-file work. Single-shot subagent invoked by `aki-main`. |
| **aki-research** | Surveys, deep-dives, comparison studies, design docs. Pulls from intrinsic knowledge, web sources, and external memory. |
| **aki-inspector** | Read-only whole-project inspection — code inventories, dependency surveys, config audits, test-coverage diagnostics. |
| **aki-suggest** | Forward-looking suggestion specialist for optimisations, refactor proposals, ideation, and creative alternatives. May propose but does not commit edits. |
| **aki-algorithm** | Algorithmic problem-solving specialist with complexity targets and benchmarking — graph, DP, greedy, search, optimisation, ML, cryptography, numerical. |
| **aki-orchestrator** | Routing specialist. Selects and dispatches specialist variants when the right specialist is ambiguous. Read-only; draws on meta-memory (A-MEM / Graphiti when available). |

**CLI one-shot flags** (pass after `opencode run --`):

```bash
opencode run -- --aki-execute "implement step 1"       # run aki-execute agent
```

**Slash commands** for the user-callable specialists:

```
/aki-research "<task>"     # invokes @aki-research
/aki-inspector "<task>"    # invokes @aki-inspector
/aki-suggest "<task>"      # invokes @aki-suggest
/aki-algorithm "<task>"    # invokes @aki-algorithm
```

The wrapper agent itself is not given a slash command — it's a `mode: primary` agent and is reachable via `Tab`-cycle, `@aki-main`, or the CLI flag.

The agents use internal emit tools (`clarify_contract_emit`, `judge_verdict_emit`, `session_summary_emit`) to signal completion. These are deny-listed from the built-in `build` / `plan` agents so they cannot be invoked outside the aki family.

---

---

### `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` — keep chatting while subagents run

By default, when `aki-main` dispatches a long-running subagent (e.g. `aki-research`, `aki-inspector`, `aki-algorithm`), the user must wait for that subagent to finish before the next prompt is accepted. Setting `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` flips this:

- The `task` tool gains a `background: boolean` parameter. With `background: true`, the subagent is launched asynchronously and the tool returns immediately with `state: running`.
- When the background subagent finishes, its result is delivered automatically as a synthetic message injected into the parent session — a push model (redesigned upstream in #29179 to remove polling). The calling agent is explicitly instructed not to poll or ask for status; a TUI toast announces completion.
- Passing a prior `task_id` resumes that subagent session instead of starting a fresh one.
- The user can keep typing while the background subagent runs; the next user message is appended to `aki-main`'s queue normally.

```bash
OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true ./opencode-local.sh
# or export in your shell to make it sticky
```

`aki-main`'s prompt is aware of the flag: when the `background` parameter is present in the task schema, it will prefer background dispatch for long-running specialists. Foreground (`background: false` / omitted) remains the default for short, latency-sensitive subagents (`aki-clarify`, `aki-rank`).

Implementation: `packages/opencode/src/tool/task.ts`, `background/job.ts`, `effect/runtime-flags.ts`.

---

### Orchestrator meta-memory & `meta_*` tools

`aki-orchestrator` maintains a persistent memory of past specialist variants and runs to inform future routing decisions. Four tools, all gated to the orchestrator agent:

| Tool | Purpose |
|---|---|
| `meta_record_variant` | Register a specialist variant (a named profile of a specialist + prompt + config) for future reference. |
| `meta_record_run` | Record the outcome of a dispatch (which variant ran, what task, success/failure signals). |
| `meta_find_similar_variants` | Look up variants semantically similar to a given task description. |
| `meta_best_variant_for` | Recommend the highest-scoring variant for a task description, based on prior runs. |

Storage lives under `Global.Path.data` (the XDG `data/opencode/` dir), so meta-memory persists across sessions and projects. Backends pluggable to A-MEM and Graphiti when available; falls back to local JSON otherwise.

Implementation: `packages/opencode/src/memory/orchestrator-meta.ts`, `orchestrator-meta-schema.ts`, and `packages/opencode/src/tool/meta-*.ts`.

---

### F14 InspectionScorer (experimental)

Skeleton of a scorer interface for measuring specialist output quality post-hoc. Currently only the `aki-inspector` scorer is wired; the interface is in place for adding `SessionScorer`, judge-derived scorers, and others.

Implementation: `packages/opencode/src/agent/_shared/scorers/aki-inspector.ts`.

---

### TUI: `shift+esc` for cancel/dismiss

All built-in TUI bindings that previously used bare `esc` are rebound to `shift+esc`:

- `session_interrupt` (interrupt current session)
- `diff_close` (close diff viewer; `q` still works)
- `prompt.autocomplete.hide`
- Dialog close, help dialog close
- Question reject / answer-edit cancel
- Permission reject / rejection-input cancel
- Shell-mode exit in the prompt
- "Back to session" from session-v2 system pane

Additionally, bare `ctrl+c` no longer quits the TUI — it only interrupts the active operation (matching the typical readline contract). Use the session-list `q` binding to quit.

This frees plain `esc` for user-defined bindings and avoids accidental cancellations on terminals that send `esc` as part of escape sequences.

---

### Copilot multi-instance factory

Each opencode instance gets an isolated GitHub Copilot auth context, so multiple parallel sessions can use Copilot concurrently without token collisions.

---

### `plugin-reminders` — file-based reminder injection

A first-party plugin (`packages/plugin-reminders/`) that injects file contents as `<system-reminder>` blocks into the model's next turn on configured lifecycle events — tool calls, subagent dispatch, compaction, or every model turn. Useful for perpetual TODO lists, scoped Q&A memory, or just-in-time procedure reminders.

Configure via `plugin` (singular) in `opencode.json` with `[spec, options]` tuples; spec can be a package name or absolute file path. Options describe the rule set: trigger (event, tool name, agent name, regex), template (file path under `.opencode/reminders/templates/`), and optional state file under `.opencode/reminders/sessions/`.

Default workspace layout:

```
.opencode/
  opencode.json                   # plugin config + hook rules
  reminders/
    hooks/                        # rule definitions
    templates/                    # reminder body files
    sessions/                     # per-session state (auto-managed)
```

See `packages/plugin-reminders/README.md` and `future/future-file-reminders.md` (in the workspace root) for the full grammar, modes, and hook map.

---

### Skill hot-reload — live `SKILL.md` updates

Any change to a `SKILL.md` file in a skill directory is detected automatically. The skill discovery scan and parsed skills cache are invalidated, and the next model turn picks up the updated skills without restarting opencode.

- Watches all configured skill directories (project, global, external)
- Debounced at 2 seconds to avoid churn during rapid saves
- Works transparently — no reload command required

Implementation: `packages/opencode/src/skill/index.ts` (per-instance `Skill.watcher` fiber, bootstrapped lazily from the discovery cache via `InstanceState`).

---

<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
