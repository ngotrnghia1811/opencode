import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { ConfigAgentEdit } from "@/config/agent-edit"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiAgentConfigError } from "../groups/config"
import { markInstanceForDisposal } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service
    const agentSvc = yield* Agent.Service
    const fs = yield* FSUtil.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    // Unlike `update`, this does not mark the instance for disposal: the new model applies after restart.
    const agent = Effect.fn("ConfigHttpApi.agent")(function* (ctx: { payload: ConfigAgentEdit.Input }) {
      const info = yield* agentSvc.get(ctx.payload.name)
      if (!info)
        return yield* new ApiAgentConfigError({
          name: "AgentConfigError",
          data: { message: `Agent "${ctx.payload.name}" not found` },
        })
      const instance = yield* InstanceState.context
      return yield* ConfigAgentEdit.update({
        name: ctx.payload.name,
        file: info.source?.path,
        directory: instance.directory,
        worktree: instance.worktree,
        patch: { model: ctx.payload.model, variant: ctx.payload.variant },
      }).pipe(
        Effect.provideService(FSUtil.Service, fs),
        Effect.mapError(
          (error) => new ApiAgentConfigError({ name: "AgentConfigError", data: { message: error.message } }),
        ),
      )
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    return handlers.handle("get", get).handle("update", update).handle("agent", agent).handle("providers", providers)
  }),
)
