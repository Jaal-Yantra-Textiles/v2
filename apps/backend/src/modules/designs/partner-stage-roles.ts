/**
 * partner-stage-roles.ts — the fixed list of production stages a partner can
 * hold on a design's roster (#2306 S1, founder decision 1, 2026-09-26).
 *
 * 🔴 This is the link's `stage_role` column, NOT its `role` column. `role`
 * already answers a different question — how the partner relates to the design
 * (`prospect` from a design inquiry, `maker` for the inquiry winner, `designer`
 * from a designer invite) — and the inquiry-close step dismisses links by
 * `role = prospect`. One enum for both questions would repeat the
 * `workspace_type` mistake, so the stage lives in its own column.
 *
 * New stages are added here, by a code change — never as free text.
 *
 * PURE data module (no server imports): the admin bundle imports it too.
 */

export const DESIGN_PARTNER_STAGE_ROLES = [
  "supplier",
  "weaving",
  "dyeing",
  "printing",
  "embroidery",
  "cutting",
  "stitching",
  "finishing",
  "sampling",
  "photoshoot",
] as const

export type DesignPartnerStageRole = (typeof DESIGN_PARTNER_STAGE_ROLES)[number]

export const DESIGN_PARTNER_STAGE_ROLE_LABELS: Record<DesignPartnerStageRole, string> = {
  supplier: "Supplier",
  weaving: "Weaving",
  dyeing: "Dyeing",
  printing: "Printing",
  embroidery: "Embroidery",
  cutting: "Cutting",
  stitching: "Stitching / tailoring",
  finishing: "Finishing",
  sampling: "Sampling",
  photoshoot: "Photoshoot",
}

export const isDesignPartnerStageRole = (
  value: unknown
): value is DesignPartnerStageRole =>
  typeof value === "string" &&
  (DESIGN_PARTNER_STAGE_ROLES as readonly string[]).includes(value)

/**
 * Default position of each making stage in the chain (#2306 decision 2).
 * Equal positions run in parallel. Missing roles are not run stages:
 * - `supplier` becomes "wait for its inventory order", never a child run;
 * - `photoshoot` is a separate batch task that waits on the run (decision 4);
 * - `sampling` is its own sample run, not a stage of a production run.
 */
export const STAGE_ROLE_POSITION: Partial<Record<DesignPartnerStageRole, number>> = {
  weaving: 1,
  dyeing: 2,
  printing: 3,
  embroidery: 4,
  cutting: 5,
  stitching: 6,
  finishing: 7,
}

export type RosterEntryLike = {
  partner_id: string
  stage_role: string | null
}

export type DraftStagePlan = {
  /** One draft stage per making-stage roster entry, `order` 1-based and dense. */
  stages: { partner_id: string; stage_role: DesignPartnerStageRole; order: number }[]
  /** Partners whose goods the first stage should wait for. */
  supplier_partner_ids: string[]
  /** Roster entries that do not become a stage, and why. */
  not_prefilled: { partner_id: string; stage_role: string | null; reason: string }[]
}

/**
 * Turns a design's roster into draft approval stages (#2306 S2). Pure: the
 * approve form edits the result before anything is sent.
 *
 * `order` is dense over the positions actually present, so a roster of
 * weaving + stitching gives 1 and 2, not 1 and 6 — the approve workflow only
 * compares orders, but a gap would read as missing stages to the admin.
 */
export const draftStagesFromRoster = (roster: RosterEntryLike[]): DraftStagePlan => {
  const plan: DraftStagePlan = { stages: [], supplier_partner_ids: [], not_prefilled: [] }
  const making: { partner_id: string; stage_role: DesignPartnerStageRole; position: number }[] = []

  for (const entry of roster) {
    const role = entry.stage_role
    if (!isDesignPartnerStageRole(role)) {
      plan.not_prefilled.push({ partner_id: entry.partner_id, stage_role: role ?? null, reason: "no stage chosen" })
      continue
    }
    if (role === "supplier") {
      if (!plan.supplier_partner_ids.includes(entry.partner_id)) {
        plan.supplier_partner_ids.push(entry.partner_id)
      }
      continue
    }
    const position = STAGE_ROLE_POSITION[role]
    if (position === undefined) {
      plan.not_prefilled.push({
        partner_id: entry.partner_id,
        stage_role: role,
        reason: role === "photoshoot" ? "photoshoot is a separate batch task" : "sampling is its own sample run",
      })
      continue
    }
    making.push({ partner_id: entry.partner_id, stage_role: role, position })
  }

  const positions = [...new Set(making.map((m) => m.position))].sort((a, b) => a - b)
  plan.stages = making
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      partner_id: m.partner_id,
      stage_role: m.stage_role,
      order: positions.indexOf(m.position) + 1,
    }))
  return plan
}
