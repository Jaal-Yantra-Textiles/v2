/**
 * Read-time projection: overlay admin corrections onto a masked census weaver.
 *
 * The census record is never mutated — the correction list stays an appended
 * list on the person_property record. This pure function produces the "effective
 * weaver" for one render by spreading `corrected_value` over the record for each
 * correction that names a field and carries a value.
 *
 * Same idea as partner-quote's `effectiveQuoteLines`: derived, never stored.
 */

export type WeaverCorrection = {
  field: string
  note?: string
  corrected_value?: unknown
  corrected_at?: string
  corrected_by?: string
}

export type AppliedWeaverCorrections = {
  /** The weaver record with corrections overlayed. */
  weaver: Record<string, any>
  /** Field names a correction actually overrode. */
  corrected_fields: string[]
}

export function applyWeaverCorrections(
  weaver: Record<string, any>,
  corrections: WeaverCorrection[] | null | undefined
): AppliedWeaverCorrections {
  const merged = { ...(weaver ?? {}) }
  const corrected_fields: string[] = []

  for (const c of corrections ?? []) {
    if (!c?.field || c.corrected_value === undefined) continue
    merged[c.field] = c.corrected_value
    corrected_fields.push(c.field)
  }

  return { weaver: merged, corrected_fields }
}