import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Agent } from "@opencode-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import os from "os"
import path from "path"
import { createEffect, createMemo, createResource, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { errorMessage } from "../../util/error"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:agent-config"

// Values saved in this session. The server keeps the startup config until restart, so the list shows these next to
// the running values. An empty string means the override was removed. `shadowed_by` is a config file that loads after
// the global config and keeps a saved value from taking effect.
type Pending = {
  model?: string
  variant?: string
  path: string
  shadowed_by?: string
}

type Patch = Pick<Pending, "model" | "variant">

const ORDER = ["primary", "all", "subagent", "hidden"]
const MODEL = /^[^/\s]+\/\S+$/
// Short labels for where the running model and variant come from. The row details show the full path.
const SCOPE = { builtin: "built-in", project: ".opencode", global: ".opencode-workspace" } as const

function tag(agent: Agent) {
  if (agent.hidden) return "hidden"
  return agent.mode
}

function model(agent: Agent) {
  if (!agent.model) return ""
  return `${agent.model.providerID}/${agent.model.modelID}`
}

function scope(agent: Agent) {
  if (!agent.source) return "unknown"
  return SCOPE[agent.source.scope]
}

// Project files show relative to the project root, other files relative to the home directory.
function shown(api: TuiPluginApi, file: string) {
  const root = api.state.path.worktree === "/" ? api.state.path.directory : api.state.path.worktree
  if (root && file.startsWith(root + path.sep)) return path.relative(root, file)
  const home = os.homedir()
  if (file.startsWith(home + path.sep)) return "~" + file.slice(home.length)
  return file
}

// Every edit goes to the global config, whatever the row's source is.
function target(api: TuiPluginApi) {
  if (!api.state.path.config) return "Writes to the global config"
  return `Writes to the global config in ${shown(api, api.state.path.config)}`
}

function describe(pending: Pending) {
  return [
    pending.model === undefined ? undefined : `model ${pending.model || "(removed)"}`,
    pending.variant === undefined ? undefined : `variant ${pending.variant || "(removed)"}`,
  ]
    .filter((item) => item !== undefined)
    .join(", ")
}

// A project config file or markdown agent loads after the global config and keeps its own value.
function shadowed(api: TuiPluginApi, file: string) {
  return `Shadowed by ${shown(api, file)}; restart will not change the effective model.`
}

function saved(api: TuiPluginApi, pending: Pending) {
  const change = `${describe(pending)} (${shown(api, pending.path)})`
  if (pending.shadowed_by) return `saved ${change}, shadowed by ${shown(api, pending.shadowed_by)}`
  return `after restart: ${change}`
}

function row(api: TuiPluginApi, agent: Agent, width: number, pending: Pending | undefined) {
  const theme = api.theme.current
  return {
    title: agent.name.padEnd(width),
    value: agent.name,
    description: `${model(agent) || "inherited"} · ${agent.variant ?? "default"}`,
    footer: (
      <>
        {pending ? (
          <span style={{ fg: theme.warning }}>{pending.shadowed_by ? "shadowed" : "pending restart"} · </span>
        ) : undefined}
        <span style={{ fg: theme.text }}>{tag(agent)}</span>
        <span style={{ fg: theme.textMuted }}> · {scope(agent)}</span>
      </>
    ),
    details: [
      ...(agent.source?.path ? [shown(api, agent.source.path)] : []),
      ...(pending ? [saved(api, pending)] : []),
    ],
  } satisfies DialogSelectOption<string>
}

function View(props: { api: TuiPluginApi; pending: Map<string, Pending>; current?: string }) {
  const size = useTerminalDimensions()
  const [error, setError] = createSignal<unknown>()
  const [agents] = createResource(() =>
    props.api.client.app
      .agents({}, { throwOnError: true })
      .then((result) => result.data ?? [])
      // Reading a rejected resource re-throws and tears down the dialog, so keep the error in a signal instead.
      .catch((cause) => {
        setError(cause)
        return []
      }),
  )

  createEffect(() => {
    const width = size().width
    if (width >= 128) {
      props.api.ui.dialog.setSize("xlarge")
      return
    }
    if (width >= 96) {
      props.api.ui.dialog.setSize("large")
      return
    }
    props.api.ui.dialog.setSize("medium")
  })

  const rows = createMemo(() => {
    const list = (agents() ?? []).toSorted(
      (a, b) => ORDER.indexOf(tag(a)) - ORDER.indexOf(tag(b)) || a.name.localeCompare(b.name),
    )
    const width = Math.max(0, ...list.map((agent) => agent.name.length))
    return list.map((agent) => row(props.api, agent, width, props.pending.get(agent.name)))
  })

  return (
    <DialogSelect
      title="Agent configs"
      placeholder="Search agents"
      options={rows()}
      current={agents.loading ? undefined : props.current}
      footerHints={[{ title: "edit", label: "enter" }]}
      emptyView={
        error() ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={props.api.theme.current.error}>Could not load agents</text>
            <text fg={props.api.theme.current.textMuted}>{errorMessage(error())}</text>
          </box>
        ) : undefined
      }
      onSelect={(item) => {
        const agent = agents()?.find((entry) => entry.name === item.value)
        if (agent) editModel(props.api, props.pending, agent)
      }}
    />
  )
}

function editModel(api: TuiPluginApi, pending: Map<string, Pending>, agent: Agent) {
  const value = pending.get(agent.name)?.model ?? model(agent)
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title={`Model for ${agent.name}`}
      placeholder="provider/model (empty removes the override)"
      value={value}
      description={() => <text fg={api.theme.current.textMuted}>{target(api)}. Applies after restart.</text>}
      onConfirm={(raw) => {
        const next = raw.trim()
        if (next && !MODEL.test(next)) {
          api.ui.toast({ variant: "error", message: "Model must look like provider/model" })
          return
        }
        api.ui.dialog.replace(() => (
          <VariantPrompt api={api} pending={pending} agent={agent} patch={next === value ? {} : { model: next }} />
        ))
      }}
    />
  ))
}

function VariantPrompt(props: { api: TuiPluginApi; pending: Map<string, Pending>; agent: Agent; patch: Patch }) {
  const [busy, setBusy] = createSignal(false)
  const value = props.pending.get(props.agent.name)?.variant ?? props.agent.variant ?? ""

  return (
    <props.api.ui.DialogPrompt
      title={`Variant for ${props.agent.name}`}
      placeholder="variant (empty removes the override)"
      value={value}
      busy={busy()}
      busyText="Saving…"
      description={() => (
        <text fg={props.api.theme.current.textMuted}>{target(props.api)}. Applies after restart.</text>
      )}
      onConfirm={(raw) => {
        if (busy()) return
        const next = raw.trim()
        const patch = next === value ? props.patch : { ...props.patch, variant: next }
        if (!Object.keys(patch).length) {
          props.api.ui.toast({ variant: "info", message: `No changes for ${props.agent.name}` })
          show(props.api, props.pending, props.agent.name)
          return
        }
        setBusy(true)
        void props.api.client.config
          .updateAgent({ name: props.agent.name, ...patch }, { throwOnError: true })
          .then((result) => {
            const saved = result.data
            if (!saved?.changed) {
              props.api.ui.toast(
                saved?.shadowed_by
                  ? {
                      variant: "warning",
                      message: `Nothing to change in ${shown(props.api, saved.path)}. ${shadowed(props.api, saved.shadowed_by)}`,
                    }
                  : { variant: "info", message: "Nothing to change in the config file" },
              )
              show(props.api, props.pending, props.agent.name)
              return
            }
            const previous = props.pending.get(props.agent.name)
            props.pending.set(props.agent.name, {
              ...previous,
              ...patch,
              path: saved.path,
              shadowed_by: saved.shadowed_by ?? previous?.shadowed_by,
            })
            props.api.ui.toast(
              saved.shadowed_by
                ? {
                    variant: "warning",
                    message: `Saved to ${shown(props.api, saved.path)}. ${shadowed(props.api, saved.shadowed_by)}`,
                  }
                : {
                    variant: "success",
                    message: `Saved to ${shown(props.api, saved.path)}. Restart opencode to apply.`,
                  },
            )
            show(props.api, props.pending, props.agent.name)
          })
          .catch((cause) => {
            props.api.ui.toast({ variant: "error", message: errorMessage(cause) })
          })
          .finally(() => {
            setBusy(false)
          })
      }}
    />
  )
}

function show(api: TuiPluginApi, pending: Map<string, Pending>, current?: string) {
  api.ui.dialog.replace(() => <View api={api} pending={pending} current={current} />)
}

const tui: TuiPlugin = async (api) => {
  const pending = new Map<string, Pending>()
  api.keymap.registerLayer({
    commands: [
      {
        name: "agents.config",
        title: "Agent configs",
        desc: "List agent models and variants and edit their config",
        category: "Agent",
        namespace: "palette",
        slashName: "agents-config",
        run() {
          show(api, pending)
        },
      },
    ],
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
