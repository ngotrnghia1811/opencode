import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { writeAck } from "@/agent/aki-eval/ack-write"

export const AkiAckCommand = effectCmd({
  command: "aki-ack <verdict_id> <finding_id> <status>",
  describe: "record an accept/dismiss/fixed acknowledgment for a verdict finding",
  builder: (yargs) =>
    yargs
      .positional("verdict_id", {
        describe: "verdict id (timestamp from verdict-<id>.yaml filename)",
        type: "string",
        demandOption: true,
      })
      .positional("finding_id", {
        describe: "finding id from the verdict's issues[].id",
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
  handler: Effect.fn("Cli.aki-ack")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("aki-ack requires a project directory")
    const result = yield* Effect.promise(() =>
      writeAck(ctx.directory, {
        verdict_id: args.verdict_id,
        finding_id: args.finding_id,
        status: args.status,
        note: args.note,
      }),
    )
    console.log(`Ack written to ${result.path} (total_acks=${result.total})`)
  }),
})
