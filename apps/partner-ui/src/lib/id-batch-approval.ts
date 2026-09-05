import type {
  IdExtractionBatchItem,
  IdExtractionDraft,
} from "../hooks/api/id-extraction-batch"

/**
 * Turning what an operator typed into the approve call's `corrections` (#1816).
 *
 * The same ID card read five times in prod did not split the name identically
 * (4x `first_name: "Tarun Debnath"`, 1x `"Tarun"`). Correcting that by hand is
 * the entire purpose of the review screen, so this is the function that decides
 * what the server is told — and there are two ways to get it wrong quietly.
 *
 * 🔴 The server applies a correction as a SHALLOW merge over the draft:
 * `{ ...draft, ...correction }`. So a correction naming `address` REPLACES the
 * whole address. Sending `{ address: { city: "Kolkata" } }` because the city
 * was the only field touched would silently delete the street, state, postal
 * code and country the reader got right. Every address edit therefore carries
 * the whole merged address, never the changed key alone.
 *
 * 🔑 And an untouched field is never sent. A correction that echoes the draft
 * back is indistinguishable from an operator's confirmation, which is fine
 * until the draft changes underneath (a retry re-reads the photograph) — then
 * the echo overwrites the newer read with the older one.
 */

/** The flat fields the review form edits. Address is handled separately. */
export const EDITABLE_DRAFT_FIELDS = [
  "first_name",
  "last_name",
  "gender",
  "date_of_birth",
  "id_type",
] as const

export type EditableDraftField = (typeof EDITABLE_DRAFT_FIELDS)[number]

export const EDITABLE_ADDRESS_FIELDS = [
  "street",
  "city",
  "state",
  "postal_code",
  "country",
] as const

export type EditableAddressField = (typeof EDITABLE_ADDRESS_FIELDS)[number]

/** What the form holds for one item: only the fields somebody typed into. */
export type ItemEdits = {
  [K in EditableDraftField]?: string
} & {
  address?: { [K in EditableAddressField]?: string }
}

export type BatchEdits = Record<string, ItemEdits>

export type DraftCorrection = Record<string, unknown>

/** Trim, and treat a field emptied by the operator as an explicit clear. */
const normalise = (v: string): string | null => {
  const t = v.trim()
  return t.length ? t : null
}

const sameValue = (a: unknown, b: unknown): boolean => {
  const norm = (v: unknown) =>
    v === undefined || v === null || v === "" ? null : String(v).trim()
  return norm(a) === norm(b)
}

/**
 * The correction for one item, or `null` when nothing was actually changed.
 *
 * Exported on its own because "did this item change?" is also the question the
 * screen asks to decide whether to show an edited marker.
 */
export const buildItemCorrection = (
  draft: IdExtractionDraft | null | undefined,
  edits: ItemEdits | undefined,
): DraftCorrection | null => {
  if (!edits) return null

  const correction: DraftCorrection = {}

  for (const field of EDITABLE_DRAFT_FIELDS) {
    const typed = edits[field]
    if (typed === undefined) continue
    const next = normalise(typed)
    if (sameValue(next, draft?.[field])) continue
    correction[field] = next
  }

  if (edits.address) {
    const current = draft?.address ?? {}
    let changed = false
    // 🔴 Whole address, always — see the shallow-merge note above.
    const merged: Record<string, string | null> = {}
    for (const field of EDITABLE_ADDRESS_FIELDS) {
      const typed = edits.address[field]
      const existing = (current as Record<string, unknown>)[field]
      if (typed === undefined) {
        merged[field] = (existing ?? null) as string | null
        continue
      }
      const next = normalise(typed)
      merged[field] = next
      if (!sameValue(next, existing)) changed = true
    }
    if (changed) correction.address = merged
  }

  return Object.keys(correction).length ? correction : null
}

export type ApprovePayload = {
  item_ids: string[]
  corrections?: Record<string, DraftCorrection>
}

/**
 * The body for `POST .../batch/:id/approve`.
 *
 * ⚠️ `item_ids` is always sent explicitly, even when the operator selected
 * everything. Omitting it means "every item with a usable draft" server-side,
 * which is a different set the moment a retry finishes between the render and
 * the click — the operator would approve a draft they never saw.
 */
export const buildApprovePayload = (
  items: Pick<IdExtractionBatchItem, "id" | "draft">[],
  selectedIds: string[],
  edits: BatchEdits,
): ApprovePayload => {
  const selected = new Set(selectedIds)
  const chosen = items.filter((i) => selected.has(i.id))

  const corrections: Record<string, DraftCorrection> = {}
  for (const item of chosen) {
    const correction = buildItemCorrection(item.draft, edits[item.id])
    if (correction) corrections[item.id] = correction
  }

  return {
    item_ids: chosen.map((i) => i.id),
    ...(Object.keys(corrections).length ? { corrections } : {}),
  }
}

/**
 * An item can be approved when it carries a draft with a name — the server's
 * own rule, recomputed here so the screen does not offer a button that will
 * come back as "skipped".
 *
 * 🔑 It reads the EDITED name, not the draft's: supplying a missing name is
 * exactly how a correction rescues a draft the reader itself refused.
 */
export const isApprovable = (
  item: Pick<IdExtractionBatchItem, "id" | "status" | "draft">,
  edits?: ItemEdits,
): boolean => {
  if (item.status === "approved") return false
  if (!item.draft) return false
  const first = edits?.first_name ?? item.draft.first_name ?? ""
  const last = edits?.last_name ?? item.draft.last_name ?? ""
  return Boolean(String(first).trim() || String(last).trim())
}
