> **This is a personal fork of [anomalyco/opencode](https://github.com/anomalyco/opencode).**
> The `dev` branch tracks upstream and adds the features below. `feat/aki-agents` layers the aki-* agent family (aki-main wrapper + aki-q / aki-eval / aki-build) on top.

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

| Agent | Purpose |
|---|---|
| **aki-main** | Orchestrator wrapper. Routes through aki-q clarification, aki-build implementation, and aki-eval verification in one session. |
| **aki-q** | Akinator-style clarifying-question ritual. Asks up to 5 high-information-gain questions, then emits a structured **Contract**. |
| **aki-build** | Scope-disciplined implementation agent. Executes one authorized work unit at a time, re-validating scope at every boundary. |
| **aki-eval** | Akinator-style code-evaluation ritual. Runs up to 6 probes against produced code, then emits a structured **Verdict**. |

**CLI one-shot flags** (pass after `opencode run --`):

```bash
opencode run -- --aki-q     "describe the feature"   # run aki-q agent
opencode run -- --aki-build "implement step 1"       # run aki-build agent
opencode run -- --aki-eval  "check this output"      # run aki-eval agent
```

The agents use internal emit tools (`contract_emit`, `verdict_emit`, `session_summary_emit`) to signal completion. These are deny-listed from the build/plan agents so they cannot be invoked outside the aki family.

---

### `opencode aki-ack` — record verdict acknowledgements

After aki-eval emits a verdict, you (or a follow-up aki-build pass) can record an acknowledgement against each finding. Acks are stored alongside the verdict file in `.opencode/aki-eval/` and merged so re-acking a finding replaces the prior entry.

```bash
opencode aki-ack <verdict_id> <finding_id> <status> [--note "<text>"]
# status ∈ accept | dismiss | fixed
```

The same operation is exposed inside the agent runtime as the `verdict_ack` tool (deny-listed from build/plan).

---

### `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` — keep chatting while subagents run

By default, when `aki-main` dispatches a long-running subagent (e.g. `aki-research`, `aki-inspector`, `aki-algorithm`), the user must wait for that subagent to finish before the next prompt is accepted. Setting `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` flips this:

- The `task` tool gains a `background: boolean` parameter. With `background: true`, the subagent is launched asynchronously and the tool returns immediately with `task_id` and `state: running`.
- A companion tool `task_status(task_id=..., wait=false|true)` lets the calling agent poll or block on the background task.
- When the background subagent finishes, its result is injected as a synthetic message into the parent session and `aki-main` resumes (or queues until the user's current turn is idle, polled every 300ms). A TUI toast announces completion.
- The user can keep typing while the background subagent runs; the next user message is appended to `aki-main`'s queue normally.

```bash
OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true ./opencode-local.sh
# or export in your shell to make it sticky
```

`aki-main`'s prompt is aware of the flag: when the `background` parameter is present in the task schema, it will prefer background dispatch for long-running specialists. Foreground (`background: false` / omitted) remains the default for short, latency-sensitive subagents (`aki-clarify`, `aki-rank`).

Implementation: `packages/opencode/src/tool/task.ts`, `task_status.ts`, `effect/runtime-flags.ts`.

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

This frees plain `esc` for user-defined bindings and avoids accidental cancellations on terminals that send `esc` as part of escape sequences.

---

### Copilot multi-instance factory

Each opencode instance gets an isolated GitHub Copilot auth context, so multiple parallel sessions can use Copilot concurrently without token collisions.

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
