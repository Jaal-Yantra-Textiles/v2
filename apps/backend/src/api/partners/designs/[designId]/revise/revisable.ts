/**
 * @file Pure revisable-status guard for the partner revise route.
 * @module API/Partners/Designs/Revise
 *
 * `reviseDesignWorkflow` only accepts designs in one of these statuses and
 * otherwise throws a generic workflow error. The partner route pre-checks
 * the design status with this pure helper so it can return a friendly
 * `422 NOT_ALLOWED` BEFORE invoking the (expensive, multi-step) workflow.
 *
 * Kept as a standalone pure module so it is unit-testable without booting
 * Medusa (there is no partner-design integration harness).
 *
 * Source of truth: `src/workflows/designs/revise-design.ts#REVISABLE_STATUSES`
 * — keep these in sync.
 */
export const REVISABLE_STATUSES = [
  "Approved",
  "Commerce_Ready",
  "In_Development",
  "Sample_Production",
  "Technical_Review",
] as const

export type RevisableStatus = (typeof REVISABLE_STATUSES)[number]

/**
 * Is a design in a status from which a new revision may be created?
 * @param status The design's current status (may be null/undefined).
 * @returns true only when the status is one of REVISABLE_STATUSES.
 */
export function isDesignRevisable(status: string | null | undefined): boolean {
  if (!status) {
    return false
  }
  return (REVISABLE_STATUSES as readonly string[]).includes(status)
}
