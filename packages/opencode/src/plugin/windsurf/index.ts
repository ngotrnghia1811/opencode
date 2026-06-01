import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { WINDSURF_MODELS } from "./models"

export async function WindsurfPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    provider: {
      id: "windsurf-devin-provider",
      async models(_provider, _ctx) {
        return WINDSURF_MODELS
      },
    },
    auth: {
      provider: "windsurf-devin-provider",
      methods: [
        {
          type: "api" as const,
          label: "Devin CLI (devin /login required once)",
        },
      ],
    },
  }
}
