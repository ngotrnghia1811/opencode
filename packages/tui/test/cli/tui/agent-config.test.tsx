/** @jsxImportSource @opentui/solid */
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta, TuiToast } from "@opencode-ai/plugin/tui"
import type { Agent } from "@opencode-ai/sdk/v2"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"

type Command = NonNullable<Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]["commands"]>[number]

const globalFile = path.join(os.homedir(), "xdg", "opencode", "opencode.json")

const agents = [
  {
    name: "build",
    mode: "primary",
    native: true,
    permission: [],
    options: {},
    model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    variant: "max",
    source: { scope: "global", path: globalFile },
  },
  {
    name: "review",
    mode: "subagent",
    permission: [],
    options: {},
    model: { providerID: "openai", modelID: "gpt-5" },
    source: { scope: "project", path: "/repo/.opencode/agent/review.md" },
  },
  {
    name: "compaction",
    mode: "primary",
    native: true,
    hidden: true,
    permission: [],
    options: {},
    source: { scope: "builtin" },
  },
] satisfies Agent[]

async function until<T>(fn: () => T | undefined, timeout = 3000): Promise<T> {
  const value = fn()
  if (value !== undefined) return value
  if (timeout <= 0) throw new Error("timed out waiting for condition")
  await Bun.sleep(10)
  return until(fn, timeout - 10)
}

const wait = (fn: () => boolean) => until(() => (fn() ? true : undefined))

async function mountAgentConfig(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { DialogProvider, useDialog },
    { DialogPrompt },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
    { default: plugin },
  ] = await Promise.all([
    import("../../../src/ui/dialog"),
    import("../../../src/ui/dialog-prompt"),
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/ui/toast"),
    import("../../../src/keymap"),
    import("../../../src/feature-plugins/system/agent-config"),
  ])

  const commands = new Map<string, Command>()
  const toasts: TuiToast[] = []
  const updates: unknown[] = []
  const client = {
    app: { agents: async () => ({ data: agents }) },
    config: {
      // Every edit goes to the global config. The review model comes from a project markdown agent, which loads
      // after the global config, so the server reports it as shadowing the edit.
      updateAgent: async (input: { name: string }) => {
        updates.push(input)
        return {
          data: {
            path: globalFile,
            changed: true,
            ...(input.name === "review" ? { shadowed_by: "/repo/.opencode/agent/review.md" } : {}),
          },
        }
      },
    },
  } as unknown as TuiPluginApi["client"]

  // Runs inside the dialog provider so the plugin drives the real dialog stack.
  function Boot(props: { keymap: TuiPluginApi["keymap"] }) {
    const dialog = useDialog()
    const base = createTuiPluginApi({ keymap: props.keymap, client })
    const api = {
      ...base,
      state: { ...base.state, path: { state, config: state, worktree: "/repo", directory: "/repo" } },
      ui: {
        ...base.ui,
        dialog,
        DialogPrompt,
        toast: (input: TuiToast) => toasts.push(input),
      },
    } as unknown as TuiPluginApi
    void plugin.tui(api, undefined, pluginMeta)
    return <box />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const registerLayer = keymap.registerLayer.bind(keymap)
    keymap.registerLayer = (layer) => {
      layer.commands?.forEach((command) => commands.set(command.name, command))
      return registerLayer(layer)
    }
    const config = createTuiResolvedConfig()
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <DialogProvider>
                    <Boot keymap={keymap} />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 150, height: 40, kittyKeyboard: true })
  await wait(() => commands.has("agents.config"))
  return { app, commands, toasts, updates }
}

type App = Awaited<ReturnType<typeof testRender>>

function frame(app: App, predicate: (text: string) => boolean) {
  return app.waitForFrame(predicate, { maxPasses: 200 })
}

// The select filter is an InputRenderable, which is also a TextareaRenderable, so skip it when looking for prompts.
async function submit(app: App, text?: string) {
  const textarea = await until(() => {
    const editor = app.renderer.currentFocusedEditor
    if (editor instanceof InputRenderable || !(editor instanceof TextareaRenderable) || editor.isDestroyed) return
    return editor
  })
  if (text !== undefined) textarea.setText(text)
  app.mockInput.pressEnter()
}

test("registers the agent config palette and slash command", async () => {
  await using tmp = await tmpdir()
  const view = await mountAgentConfig(tmp.path)
  try {
    expect(view.commands.get("agents.config")).toMatchObject({
      title: "Agent configs",
      namespace: "palette",
      slashName: "agents-config",
    })
  } finally {
    view.app.renderer.destroy()
  }
})

test("lists every agent with model, variant, tag, and config source", async () => {
  await using tmp = await tmpdir()
  const view = await mountAgentConfig(tmp.path)
  try {
    view.commands.get("agents.config")!.run?.({} as never)
    const text = await frame(view.app, (value) => value.includes("compaction"))
    expect(text).toContain("anthropic/claude-sonnet-4 · max")
    expect(text).toContain("primary · .opencode-workspace")
    expect(text).toContain(path.join("~", "xdg", "opencode", "opencode.json"))
    expect(text).toContain("openai/gpt-5 · default")
    expect(text).toContain("subagent · .opencode")
    expect(text).toContain(".opencode/agent/review.md")
    expect(text).toContain("inherited · default")
    expect(text).toContain("hidden · built-in")
  } finally {
    view.app.renderer.destroy()
  }
})

test("saves a new model to the global config and marks the row pending restart", async () => {
  await using tmp = await tmpdir()
  const view = await mountAgentConfig(tmp.path)
  try {
    view.commands.get("agents.config")!.run?.({} as never)
    await frame(view.app, (value) => value.includes("compaction"))
    await wait(() => view.app.renderer.currentFocusedEditor instanceof InputRenderable)
    await view.app.mockInput.typeText("build")
    await frame(view.app, (value) => !value.includes("compaction"))
    view.app.mockInput.pressEnter()

    const prompt = await frame(view.app, (value) => value.includes("Model for build"))
    expect(prompt).toContain("Writes to the global config")
    await submit(view.app, "anthropic/claude-opus-4")
    await frame(view.app, (value) => value.includes("Variant for build"))
    await submit(view.app)

    await wait(() => view.toasts.length > 0)
    expect(view.updates).toEqual([{ name: "build", model: "anthropic/claude-opus-4" }])
    expect(view.toasts).toEqual([
      {
        variant: "success",
        message: `Saved to ${path.join("~", "xdg", "opencode", "opencode.json")}. Restart opencode to apply.`,
      },
    ])
    const text = await frame(view.app, (value) => value.includes("pending restart"))
    expect(text).toContain(
      `after restart: model anthropic/claude-opus-4 (${path.join("~", "xdg", "opencode", "opencode.json")})`,
    )
  } finally {
    view.app.renderer.destroy()
  }
})

test("warns when a later config file shadows the saved model", async () => {
  await using tmp = await tmpdir()
  const view = await mountAgentConfig(tmp.path)
  try {
    view.commands.get("agents.config")!.run?.({} as never)
    await frame(view.app, (value) => value.includes("compaction"))
    await wait(() => view.app.renderer.currentFocusedEditor instanceof InputRenderable)
    await view.app.mockInput.typeText("review")
    await frame(view.app, (value) => !value.includes("compaction"))
    view.app.mockInput.pressEnter()

    await frame(view.app, (value) => value.includes("Model for review"))
    await submit(view.app, "anthropic/claude-opus-4")
    await frame(view.app, (value) => value.includes("Variant for review"))
    await submit(view.app)

    await wait(() => view.toasts.length > 0)
    expect(view.updates).toEqual([{ name: "review", model: "anthropic/claude-opus-4" }])
    expect(view.toasts).toEqual([
      {
        variant: "warning",
        message: `Saved to ${path.join("~", "xdg", "opencode", "opencode.json")}. Shadowed by .opencode/agent/review.md; restart will not change the effective model.`,
      },
    ])
    const text = await frame(view.app, (value) => value.includes("shadowed ·"))
    expect(text).not.toContain("pending restart")
    expect(text).toContain("shadowed by .opencode/agent/review.md")
  } finally {
    view.app.renderer.destroy()
  }
})

const pluginMeta = {
  id: "internal:agent-config",
  source: "internal",
  spec: "internal:agent-config",
  target: "internal:agent-config",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta
