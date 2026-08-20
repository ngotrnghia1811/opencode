import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { type BoxRenderable, MouseButton, type MouseEvent, type TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"

const id = "internal:sidebar-scratchpad"

const SAVE_DEBOUNCE_MS = 500
const METADATA_KEY = "scratchpad"
const MIN_HEIGHT = 3

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  let textarea: TextareaRenderable | undefined
  let padBox: BoxRenderable | undefined
  let activeSession: string | undefined
  let metadata: Record<string, unknown> = {}
  let savedText = ""
  let draftText = ""
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const [height, setHeight] = createSignal(4)
  const [overflow, setOverflow] = createSignal(false)
  const [thumbTop, setThumbTop] = createSignal(0)
  const [thumbHeight, setThumbHeight] = createSignal(1)
  let resizing = false
  let dragStartY = 0
  let dragStartHeight = 0

  function persist(sessionID: string, text: string) {
    if (text === savedText) return
    savedText = text
    const current = props.api.state.session.get(sessionID)
    const merged = { ...metadata, ...current?.metadata, [METADATA_KEY]: text }
    metadata = merged
    void props.api.client.session.update({ sessionID, metadata: merged })
  }

  function refreshScroll() {
    const target = textarea
    if (!target || target.isDestroyed) return
    const total = target.virtualLineCount
    const visible = height()
    const maxScroll = Math.max(0, total - visible)
    setOverflow(maxScroll > 0)
    if (maxScroll === 0) return
    const thumb = Math.max(1, Math.round((visible * visible) / total))
    const scroll = Math.min(target.scrollY, maxScroll)
    setThumbHeight(thumb)
    setThumbTop(Math.round(((visible - thumb) * scroll) / maxScroll))
  }

  function schedulePersist() {
    const target = textarea
    if (!target || target.isDestroyed) return
    draftText = target.plainText
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persist(props.session_id, draftText), SAVE_DEBOUNCE_MS)
    refreshScroll()
  }

  function loadDraft(sessionID: string) {
    const current = props.api.state.session.get(sessionID)
    metadata = current?.metadata ?? {}
    const initial = metadata[METADATA_KEY]
    savedText = typeof initial === "string" ? initial : ""
    const target = textarea
    if (target && !target.isDestroyed) target.setText(savedText)
    queueMicrotask(refreshScroll)
  }

  // Drag-resize: the visible bottom border + the `▔▔▔` strip above it are the
  // grab zone (bottom 2 rows of the pad box). Mouse capture is only established
  // by opentui on the first "drag" event at whatever element is under the
  // pointer, so a dedicated 1-row handle is unreliable: the initial flick can
  // land outside it and capture goes elsewhere. Instead the container (which is
  // tall) owns the drag handlers: any descendant that ends up captured bubbles
  // the drag events up to it, so resize keeps tracking regardless of where the
  // grab started. `resizing` gates against selection drags inside the textarea.
  function startResize(event: MouseEvent) {
    if (event.button !== MouseButton.LEFT) return
    if (padBox && event.y < padBox.y + padBox.height - 2) return
    resizing = true
    dragStartY = event.y
    dragStartHeight = height()
  }

  function resize(event: MouseEvent) {
    if (!resizing) return
    // No upper bound: the sidebar content lives in a scrollbox, so an
    // oversized pad scrolls with the rest of the sidebar instead of
    // breaking the layout.
    setHeight(Math.max(MIN_HEIGHT, dragStartHeight + (event.y - dragStartY)))
    refreshScroll()
  }

  function endResize() {
    resizing = false
  }

  // Both actions are explicit user intent, so they bypass the 500ms save
  // debounce and flush immediately. If the buffer mutation fires its own
  // content-changed event first (schedulePersist), the later persist() is a
  // no-op thanks to the `text === savedText` guard — safe either order.
  function selectAllPad() {
    const target = textarea
    if (!target || target.isDestroyed) return
    target.selectAll()
    refreshScroll()
  }

  function clearPad() {
    const target = textarea
    if (!target || target.isDestroyed) return
    if (target.plainText === "") return
    target.clear()
    clearTimeout(saveTimer)
    persist(props.session_id, "")
    refreshScroll()
  }

  createEffect(() => {
    const sessionID = props.session_id
    if (sessionID === activeSession) return
    if (activeSession !== undefined && draftText !== savedText) {
      clearTimeout(saveTimer)
      persist(activeSession, draftText)
    }
    activeSession = sessionID
    loadDraft(sessionID)
  })

  onCleanup(() => {
    clearTimeout(saveTimer)
    if (activeSession !== undefined && draftText !== savedText) persist(activeSession, draftText)
  })

  return (
    <box onMouseDown={() => textarea?.focus()}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme().text}>
          <b>Scratchpad</b>
        </text>
        <box flexDirection="row" gap={2}>
          <text fg={theme().textMuted} onMouseDown={selectAllPad}>
            select all
          </text>
          <text fg={theme().textMuted} onMouseDown={clearPad}>
            clear pad
          </text>
        </box>
      </box>
      <box
        ref={(r: BoxRenderable) => {
          padBox = r
        }}
        flexDirection="column"
        backgroundColor={theme().backgroundElement}
        border
        borderStyle="rounded"
        borderColor={theme().border}
        onMouseDown={startResize}
        onMouseDrag={resize}
        onMouseUp={endResize}
        onMouseScroll={refreshScroll}
        onSizeChange={refreshScroll}
      >
        <box flexDirection="row">
          <textarea
            ref={(r: TextareaRenderable) => {
              textarea = r
            }}
            height={height()}
            wrapMode="char"
            // Explicit super(⌘)+up/down jump bindings (opentui defaults
            // already include these; declaring them makes the hotkeys
            // explicit and robust to upstream default changes). Only
            // effective while the textarea is focused — renderable key
            // handlers are registered on focus and dropped on blur.
            keyBindings={[
              { name: "up", super: true, action: "buffer-home" },
              { name: "down", super: true, action: "buffer-end" },
            ]}
            placeholder="Take notes"
            placeholderColor={theme().textMuted}
            textColor={theme().textMuted}
            focusedTextColor={theme().text}
            cursorColor={theme().text}
            backgroundColor={theme().backgroundElement}
            focusedBackgroundColor={theme().backgroundElement}
            onMouseDown={(r: MouseEvent) => r.target?.focus()}
            onContentChange={schedulePersist}
            onCursorChange={refreshScroll}
          />
          <box
            width={1}
            flexShrink={0}
            position="relative"
            height={height()}
            backgroundColor={theme().backgroundElement}
          >
            <Show when={overflow()}>
              <box
                position="absolute"
                top={thumbTop()}
                height={thumbHeight()}
                width={1}
                backgroundColor={theme().border}
              />
            </Show>
          </box>
        </box>
        <box height={1} justifyContent="center" onMouseDown={startResize}>
          <text fg={theme().textMuted}>▔▔▔</text>
        </box>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 250,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
