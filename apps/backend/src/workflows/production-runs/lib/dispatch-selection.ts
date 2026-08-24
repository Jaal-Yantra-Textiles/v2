/**
 * What to dispatch a run with, preferring identity over label.
 *
 * Ids win outright: a name may match two templates that are different process
 * steps sharing one label (#1261), and dispatch refuses such a name rather than
 * guessing. Returns null when the approval named nothing — that run is meant to
 * be dispatched later, by hand.
 *
 * Lives here rather than beside the approval route (#1268, where it started)
 * because it is now needed by the SUBSCRIBERS that advance a chain hop by hop.
 * Those read the same two fields and must make the same choice; when one of
 * them read only `dispatch_template_names`, every chain approved the preferred
 * way — by id — stalled silently at each hop with a single log line.
 */

/**
 * Deliberately open: every caller passes a WHOLE production run (or a
 * run-shaped row from a list projection), not a two-field object built for this
 * function. Closing the type would make each of those an excess-property error
 * at the call site, for no gain — the only fields read are the two named here.
 */
export type DispatchTemplateSource = {
  dispatch_template_ids?: string[] | null
  dispatch_template_names?: string[] | null
  [key: string]: unknown
}

export type DispatchSelection =
  | { template_ids: string[] }
  | { template_names: string[] }
  | null

const clean = (values: unknown): string[] =>
  (Array.isArray(values) ? values : []).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  )

export const selectDispatchInput = (
  run: DispatchTemplateSource
): DispatchSelection => {
  const ids = clean(run?.dispatch_template_ids)
  if (ids.length) {
    return { template_ids: ids }
  }

  const names = clean(run?.dispatch_template_names)
  if (names.length) {
    return { template_names: names }
  }

  return null
}
