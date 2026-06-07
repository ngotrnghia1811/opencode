import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { writeObservationAck } from "@/agent/aki-sidekick/ack-write"

export const AkiSkAckCommand = effectCmd({
  command: "aki-sk-ack <observation_id> <status>",
  describe: "record an accept/dismiss/fixed acknowledgment for a sidekick observation",
  builder: (yargs) =>
    yargs
      .positional("observation_id", {
        describe: "observation id from sidekick output",
        type: "string",
        demandOption: true,
      })
      .positional("status", {
        describe: "ack status",
        type: "string",
        choices: ["accept", "dismiss", "fixed"] as const,
        demandOption: true,
      })
      .option("note", {
        describe: "optional human-readable note",
        type: "string",
      }),
  handler: Effect.fn("Cli.aki-sk-ack")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("aki-sk-ack requires a project directory")
    const result = yield* Effect.promise(() =>
      writeObservationAck(ctx.directory, {
        observation_id: args.observation_id,
        status: args.status,
        note: args.note,
      }),
    )
    console.log(`Observation ack written to ${result.path} (total_acks=${result.total})`)
  }),
})
