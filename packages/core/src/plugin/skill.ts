/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpencodeContent from "./skill/customize-opencode.md" with { type: "text" }
import criticNotJudgeStanceContent from "./skill/critic-not-judge-stance.md" with { type: "text" }
import critiqueFaultTaxonomyContent from "./skill/critique-fault-taxonomy.md" with { type: "text" }
import xaiFailureReportContent from "./skill/xai-failure-report.md" with { type: "text" }
import hitlEscalationProtocolContent from "./skill/hitl-escalation-protocol.md" with { type: "text" }
import livingSpecDisciplineContent from "./skill/living-spec-discipline.md" with { type: "text" }
import planInspectionChecklistContent from "./skill/plan-inspection-checklist.md" with { type: "text" }
import reflexionPipelineContent from "./skill/reflexion-pipeline.md" with { type: "text" }

export const CustomizeOpencodeContent = customizeOpencodeContent
export const CriticNotJudgeStanceContent = criticNotJudgeStanceContent
export const CritiqueFaultTaxonomyContent = critiqueFaultTaxonomyContent
export const XaiFailureReportContent = xaiFailureReportContent
export const HitlEscalationProtocolContent = hitlEscalationProtocolContent
export const LivingSpecDisciplineContent = livingSpecDisciplineContent
export const PlanInspectionChecklistContent = planInspectionChecklistContent
export const ReflexionPipelineContent = reflexionPipelineContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-opencode",
            description:
              "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.",
            location: AbsolutePath.make("/builtin/customize-opencode.md"),
            content: CustomizeOpencodeContent,
          }),
        }),
      )
    })
  }),
})
