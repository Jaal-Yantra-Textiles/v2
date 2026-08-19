/**
 * Strip half-written option rows before a spec is saved.
 *
 * `handleSave` already cleaned `colors` and `fields` — "losing the whole save
 * over a row the admin forgot about is worse than silently ignoring it". When
 * option groups shipped they were the one collection that never got added to
 * that list, and the form MAKES a blank row on its own: `emptyOption` is born
 * with one empty value, deliberately, because the route rejects a group with
 * none. So adding a group and saving without typing a choice produced
 *
 *   Invalid request: Value for field 'options, 0, values, 0, label' too small,
 *   expected at least: '1'
 *
 * — a zod path shown to a partner, about a row the form itself created.
 *
 * Two different mistakes hide in there and they must not be treated alike:
 *
 *   - A group nobody touched is noise. Drop it, exactly like a blank colour.
 *   - A group that WAS named but has no choices left is a real error — the
 *     piece would be unorderable if the group is `required` — so say that in
 *     words rather than letting the route answer in field paths.
 */

export type CleanableOptionValue = {
  label?: string | null
  note?: string | null
  order?: number
  available?: boolean
}

export type CleanableOption = {
  key?: string | null
  label?: string | null
  help_text?: string | null
  required?: boolean
  order?: number
  values?: CleanableOptionValue[] | null
}

export type CleanSpecOptionsResult<T extends CleanableOption> =
  | { ok: true; options: T[] }
  | { ok: false; error: string }

/** What a group is called when it has no label — for a readable message. */
const nameOf = (o: CleanableOption, index: number): string =>
  o.label?.trim() || o.key?.trim() || `Choice ${index + 1}`

/**
 * PURE: the options to send, or the message to show instead.
 *
 * Trims every label, drops values with none, then drops groups that are
 * entirely untouched. Anything left that cannot be saved is reported as prose.
 */
export const cleanSpecOptionsForSave = <T extends CleanableOption>(
  options: T[] | null | undefined
): CleanSpecOptionsResult<T> => {
  const cleaned = (options ?? []).map((o) => ({
    ...o,
    key: o.key?.trim() ?? "",
    label: o.label?.trim() ? o.label.trim() : null,
    help_text: o.help_text?.trim() ? o.help_text.trim() : null,
    values: (o.values ?? [])
      .filter((v) => (v.label ?? "").trim().length > 0)
      .map((v) => ({
        ...v,
        label: (v.label ?? "").trim(),
        note: v.note?.trim() ? v.note.trim() : null,
      })),
  })) as T[]

  // Untouched groups: no name of any kind AND no surviving choices. The blank
  // row the form seeds on "add a choice" is exactly this.
  const kept = cleaned.filter(
    (o) =>
      (o.key ?? "").length > 0 ||
      (o.label ?? null) !== null ||
      (o.values ?? []).length > 0
  )

  const noValues = kept.findIndex((o) => (o.values ?? []).length === 0)
  if (noValues !== -1) {
    const name = nameOf(kept[noValues], noValues)
    return {
      ok: false,
      error: `"${name}" has no choices for the customer to pick from. Add at least one, or remove the group.`,
    }
  }

  const noKey = kept.findIndex((o) => !(o.key ?? "").length)
  if (noKey !== -1) {
    const name = nameOf(kept[noKey], noKey)
    return {
      ok: false,
      error: `"${name}" needs a key — a short internal name like "embroidery".`,
    }
  }

  return { ok: true, options: kept }
}
