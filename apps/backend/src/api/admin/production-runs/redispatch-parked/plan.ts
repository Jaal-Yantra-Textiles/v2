/**
 * Deciding which parked runs go back out, and to whom.
 *
 * Pure so the safety property is checkable without a container: a run is always
 * re-assigned to ITS OWN `previous_partner_id`, never to the `partner_id` in
 * the request. That field only filters. Routing by the requested partner would
 * mean one mistyped id hands a batch of one partner's work to another, and
 * dispatch notifies them, so it is not recoverable by editing a row afterwards.
 */

export type ParkedRun = {
  id: string
  previous_partner_id?: string | null
  design_id?: string | null
  quantity?: number | null
  cancelled_reason?: string | null
}

export type RedispatchPlan = {
  /** Runs that will go back out, each paired with the partner it came from. */
  selected: Array<{ run: ParkedRun; partner_id: string }>
  /** Parked runs with no previous partner — nowhere to send them back to. */
  orphaned: ParkedRun[]
  /** Eligible but cut by `limit`. */
  deferred: ParkedRun[]
}

export function planRedispatch(
  runs: ParkedRun[],
  options: { partnerId?: string | null; limit?: number } = {}
): RedispatchPlan {
  const matchesPartner = (r: ParkedRun) =>
    !options.partnerId || r.previous_partner_id === options.partnerId

  const considered = (runs ?? []).filter(matchesPartner)

  // No previous partner means the run was parked before the field existed, or
  // by a path that never set it. There is no "same partner" to send it back to,
  // and picking one would be inventing an assignment.
  const orphaned = considered.filter((r) => !r.previous_partner_id)
  const eligible = considered.filter((r) => Boolean(r.previous_partner_id))

  const cut = options.limit ?? eligible.length
  return {
    selected: eligible.slice(0, cut).map((run) => ({
      run,
      partner_id: run.previous_partner_id as string,
    })),
    orphaned,
    deferred: eligible.slice(cut),
  }
}
