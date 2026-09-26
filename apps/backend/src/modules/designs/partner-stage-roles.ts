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
