import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Schema, Stream, Duration } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import { SkillPlugin } from "@opencode-ai/core/plugin/skill"
import { Permission } from "@/permission"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Config } from "@/config/config"
import { FrontmatterError } from "@opencode-ai/core/v1/config/error"
import { ConfigMarkdown } from "@/config/markdown"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Glob } from "@opencode-ai/core/util/glob"
import { Discovery } from "./discovery"
import {
  CriticNotJudgeStanceContent,
  CritiqueFaultTaxonomyContent,
  XaiFailureReportContent,
  HitlEscalationProtocolContent,
  LivingSpecDisciplineContent,
  PlanInspectionChecklistContent,
  ReflexionPipelineContent,
} from "@opencode-ai/core/plugin/skill"
import { isRecord } from "@/util/record"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"

const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

// Built-in skill that ships with opencode. The model's intuition for what an
// opencode.json should look like is often wrong, and opencode hard-fails on
// invalid config, so users hit cryptic startup errors. Loading this skill
// when the model is asked to touch opencode's own config files gives it the
// actual schemas instead of guesses.
const CUSTOMIZE_OPENCODE_SKILL_NAME = "customize-opencode"
const CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION =
  "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself."
const CUSTOMIZE_OPENCODE_SKILL_BODY = SkillPlugin.CustomizeOpencodeContent

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
  content: Schema.String,
})
export type Info = Schema.Schema.Type<typeof Info>

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

function isSkillFrontmatter(data: unknown): data is { name: string; description?: string } {
  return (
    isRecord(data) &&
    typeof data.name === "string" &&
    (data.description === undefined || typeof data.description === "string")
  )
}

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("SkillInvalidError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Issue)),
}) {}

export class NameMismatchError extends Schema.TaggedErrorClass<NameMismatchError>()("SkillNameMismatchError", {
  path: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Skill.NotFoundError", {
  name: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Skill "${this.name}" not found. Available skills: ${this.available.join(", ") || "none"}`
  }
}

type State = {
  skills: Record<string, Info>
  dirs: Set<string>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly require: (name: string) => Effect.Effect<Info, NotFoundError>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  readonly invalidate: () => Effect.Effect<void>
}

const add = Effect.fnUntraced(function* (state: State, match: string, events: EventV2Bridge.Service["Service"]) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = FrontmatterError.isInstance(err) ? err.data.message : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        yield* Effect.logError("failed to load skill", { skill: match, error: err })
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) return

  if (state.skills[md.data.name]) {
    yield* Effect.logWarning("duplicate skill name", {
      name: md.data.name,
      existing: state.skills[md.data.name].location,
      duplicate: match,
    })
  }

  state.dirs.add(path.dirname(match))
  state.skills[md.data.name] = {
    name: md.data.name,
    description: md.data.description,
    location: match,
    content: md.content,
  }
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      return Effect.logError(`failed to scan ${opts.scope} skills`, { dir: root, error: error }).pipe(
        Effect.as([] as string[]),
      )
    }),
  )

  for (const match of matches) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: FSUtil.Interface,
  global: Global.Interface,
  disableExternalSkills: boolean,
  disableClaudeCodeSkills: boolean,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  const externalDirs: string[] = []
  if (!disableExternalSkills) {
    if (!disableClaudeCodeSkills) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  const configDirs = yield* config.directories()
  for (const dir of configDirs) {
    yield* scan(state, dir, OPENCODE_SKILL_PATTERN)
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      yield* Effect.logWarning("skill path not found", { path: dir })
      continue
    }

    yield* scan(state, dir, SKILL_PATTERN)
  }

  for (const url of cfg.skills?.urls ?? []) {
    const pulledDirs = yield* discovery.pull(url)
    for (const dir of pulledDirs) {
      yield* scan(state, dir, SKILL_PATTERN)
    }
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (
  state: State,
  discovered: DiscoveryState,
  events: EventV2Bridge.Service["Service"],
) {
  yield* Effect.forEach(discovered.matches, (match) => add(state, match, events), {
    concurrency: "unbounded",
    discard: true,
  })

  yield* Effect.logInfo("init", { count: Object.keys(state.skills).length })
})

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const fsys = yield* FSUtil.Service
    const global = yield* Global.Service
    const flags = yield* RuntimeFlags.Service
    // Explicit value-type arg breaks the type-inference cycle between
    // `discovered` (which bootstraps `watcher`) and `watcher` (which
    // invalidates `discovered`). The runtime forward-reference is safe: both
    // closures only run on first `get`, long after all three are assigned.
    const discovered: InstanceState.InstanceState<DiscoveryState> = yield* InstanceState.make<DiscoveryState>(
      Effect.fn("Skill.discovery")(function* (ctx) {
        const result = yield* discoverSkills(
          config,
          discovery,
          fsys,
          global,
          flags.disableExternalSkills,
          flags.disableClaudeCodeSkills,
          ctx.directory,
          ctx.worktree,
        )
        // Every Skill method funnels through `discovered`, so this is the
        // single chokepoint that reliably starts the per-instance SKILL.md
        // hot-reload watcher (see `watcher` below). It runs lazily on first
        // skill access — within a request/bootstrap fiber that has InstanceRef
        // provided — so the watcher's forked fiber inherits InstanceRef.
        yield* InstanceState.get(watcher)
        return result
      }),
    )
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const s: State = { skills: {}, dirs: new Set() }
        // Register the built-in skill BEFORE disk discovery so a user-disk
        // skill with the same name can override it.
        s.skills[CUSTOMIZE_OPENCODE_SKILL_NAME] = {
          name: CUSTOMIZE_OPENCODE_SKILL_NAME,
          description: CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION,
          location: "<built-in>",
          content: CUSTOMIZE_OPENCODE_SKILL_BODY,
        }

        // Sidekick subsystem built-in skills — registered BEFORE disk discovery
        // so user-disk skills of the same name can override.
        const SIDEKICK_BUILTIN_SKILLS = [
          {
            name: "critic-not-judge-stance",
            description:
              "Epistemic posture for non-executing critic agents: verify-before-assert, technical-not-performative, no gate authority, bidirectional translation. Load when acting as a persistent observer/critic of a coder agent; when producing suggestions, observations, or annotations that a human will evaluate; or when translating between human narrative and coder execution traces.",
            content: CriticNotJudgeStanceContent,
          },
          {
            name: "critique-fault-taxonomy",
            description:
              "Diagnostic lens for classifying opencode agent failures into the six-category fault taxonomy: initialization, role_deviation, memory_state, orchestration, tool_integration, plan_quality. Load when observing a coder failure, anomaly, or unexpected output; when classifying a failure before reporting it; or when performing a Layer-2 LLM anomaly pass on watcher observations.",
            content: CritiqueFaultTaxonomyContent,
          },
          {
            name: "xai-failure-report",
            description:
              "Structured three-part failure report format for translating coder failures into human-interpretable explanations: classification (category, severity, pattern), root cause (summary, evidence, contributing factors), recommendation (options a/b/c with suggested + rationale). Load when producing a failure report (§5.4) or output annotation (§8.3) from coder observations.",
            content: XaiFailureReportContent,
          },
          {
            name: "hitl-escalation-protocol",
            description:
              "Three-tier human-in-the-loop escalation discipline for non-executing critic agents: trigger taxonomy (hard/soft/batch), auto-escalation thresholds, interrupt formatting, uncertainty ledger tracking, and human-on-the-loop posture. Load when evaluating whether to interrupt autonomous execution; when preparing HITL content for delivery; or when updating the uncertainty ledger with new observations.",
            content: HitlEscalationProtocolContent,
          },
          {
            name: "living-spec-discipline",
            description:
              "Maintain a spec as a living, versioned, shared source of truth with a decision log, uncertainty ledger, and realignment workflow. Supersedes one-shot spec generation — the spec evolves across the full session (ELICIT → SPEC → PLAN → EXECUTE → REPLAN → REALIGN). Load when creating, revising, or realigning a spec that will be consumed by both a human and a coder agent across multiple phases.",
            content: LivingSpecDisciplineContent,
          },
          {
            name: "plan-inspection-checklist",
            description:
              "Seven-dimensional plan quality inspection before any plan reaches the coder: completeness, feasibility, risk coverage, dependency validity (DAG), scope hygiene, ambiguity, sequencing. Load when a plan (task graph) has been generated and must be inspected before human approval or coder release.",
            content: PlanInspectionChecklistContent,
          },
          {
            name: "reflexion-pipeline",
            description:
              "Internal self-critique loop before surfacing any observation to the human: generate observation → critique (is it accurate? necessary? novel? actionable?) → revise (remove noise, sharpen action) → present or batch. Load when preparing to surface an observation, suggestion, or report to a human; when the parent sidekick agent is about to route content to aki-main for delivery.",
            content: ReflexionPipelineContent,
          },
        ]
        for (const entry of SIDEKICK_BUILTIN_SKILLS) {
          s.skills[entry.name] = {
            name: entry.name,
            description: entry.description,
            location: "<built-in>",
            content: entry.content,
          }
        }

        yield* loadSkills(s, yield* InstanceState.get(discovered), events)
        return s
      }),
    )

    // Per-instance SKILL.md hot-reload watcher.
    //
    // This MUST live inside an InstanceState.make closure (not at layer level):
    // the Skill service is app-level/shared, so a fiber forked at layer scope
    // has no InstanceRef, and `InstanceState.invalidate` (which resolves the
    // current directory via InstanceRef) would `Effect.die("InstanceRef not
    // provided")` the moment a SKILL.md event fired. Hosting the subscription
    // in its own per-instance cache means the forked fiber inherits InstanceRef
    // from the instance's lookup fiber (same pattern as vcs.ts branch-watch).
    //
    // It is a dedicated cache (not `discovered`/`state`) so that invalidating
    // those two from the reload callback does not interrupt the host fiber.
    // It is bootstrapped lazily from the `discovered` lookup above.
    const watcher: InstanceState.InstanceState<void> = yield* InstanceState.make<void>(
      (_ctx) =>
        Effect.gen(function* () {
          yield* events.subscribe(Watcher.Event.Updated).pipe(
            Stream.filter((evt) => evt.data.file.endsWith("SKILL.md")),
            Stream.debounce(Duration.seconds(2)),
            Stream.runForEach(
              Effect.fn("Skill.reload")(function* () {
                yield* Effect.logInfo("skill file changed, hot-reloading")
                yield* InstanceState.invalidate(discovered)
                yield* InstanceState.invalidate(state)
              }),
            ),
            Effect.forkScoped,
          )
        }),
    )

    const invalidate = Effect.fn("Skill.invalidate")(function* () {
      yield* Effect.logInfo("skill invalidate requested")
      yield* InstanceState.invalidate(discovered)
      yield* InstanceState.invalidate(state)
    })

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name]
    })

    const require = Effect.fn("Skill.require")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const info = s.skills[name]
      if (info) return info
      return yield* new NotFoundError({ name, available: Object.keys(s.skills).toSorted() })
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    return Service.of({ get, require, all, dirs, available, invalidate })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export function fmt(list: Info[], opts: { verbose: boolean }) {
  const described = list.filter((skill) => skill.description !== undefined)
  if (described.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...described
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n")
}

export const node = LayerNode.make(layer, [
  Discovery.node,
  Config.node,
  EventV2Bridge.node,
  FSUtil.node,
  Global.node,
  RuntimeFlags.node,
])

export * as Skill from "."
