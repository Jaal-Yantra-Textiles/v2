/**
 * Which persona the partner workspace is (#2061 / #2029).
 *
 * `partner.workspace_type` is the typed enum column and the ONLY thing allowed
 * to decide. `metadata.use_type` is the legacy blob it replaced; it is kept on
 * the row but it no longer decides anything.
 *
 * WHY THIS ONE DOES NOT KEEP THE BLOB AS A FALLBACK
 * -------------------------------------------------
 * The #2029 pattern is normally "typed field first, blob as fallback" — see
 * `isCollatedOrder`, where the typed kind is NULLABLE, so an absent read really
 * does mean "nobody has told me" and the blob is the only other witness.
 *
 * `workspace_type` is not that. It is `not null` with a database default of
 * `'manufacturer'` (see the partner model and .snapshot-partner.json), so every
 * row has a value and the expression this replaces —
 *
 *     partner.workspace_type || partner.metadata.use_type
 *
 * — could never reach its right-hand side. Verified on prod 2026-09-15: of the
 * 5 partners of 31 who carry a `use_type` at all, the 3 whose blob DISAGREES
 * with the column (GOF, Perennial, Unique Pashmina — all `use_type: "seller"`,
 * all `workspace_type: "manufacturer"`) are already resolving to manufacturer
 * and have been for as long as the column has existed. The other 2 (Raja
 * Shawls, Saransh Sharma) say `manufacturer` in both, so they cannot differ
 * either way.
 *
 * So dropping the fallback changes no partner's sidebar. What it removes is a
 * line of code that CLAIMED legacy partners were honoured while they were not.
 *
 * 🔴 The blob still MEANS something, and it is not this. For those 3 partners
 * `use_type: "seller"` is the only record that they once stated they sell
 * direct, and the column's `'manufacturer'` may just be the default nobody
 * changed. That is a question for a human, not for `||` — read it with
 * `legacyUseType` and show it; never resolve with it. Do not delete the key.
 */

export type WorkspaceType = "seller" | "manufacturer" | "individual" | "designer"

type PartnerLike = {
  workspace_type?: string | null
  metadata?: Record<string, unknown> | null
} | null | undefined

/**
 * The persona to route, gate and render on. The typed column, and nothing else.
 *
 * Deliberately NOT validated against the four known values: the enum's check
 * constraint already guarantees membership, and rejecting an unrecognised one
 * here would silently hand every partner of a newly-added persona the default
 * sidebar instead of failing loudly.
 */
export const resolveWorkspaceType = (
  partner: PartnerLike
): WorkspaceType | undefined =>
  (partner?.workspace_type as WorkspaceType | undefined) || undefined

/**
 * What the partner once said in the legacy blob, for DISPLAY only.
 *
 * Never feed this to a decision. It exists so the 3 partners whose stated
 * intent disagrees with their column can be surfaced to a human rather than
 * quietly overwritten.
 */
export const legacyUseType = (partner: PartnerLike): string | undefined => {
  const value = (partner?.metadata as Record<string, unknown> | null | undefined)
    ?.use_type
  return typeof value === "string" && value ? value : undefined
}

/**
 * The partner stated one persona in the legacy blob and carries another in the
 * typed column. True for 3 partners on prod as of 2026-09-15.
 */
export const workspaceTypeDisagreesWithLegacy = (
  partner: PartnerLike
): boolean => {
  const legacy = legacyUseType(partner)
  return Boolean(legacy) && legacy !== resolveWorkspaceType(partner)
}
