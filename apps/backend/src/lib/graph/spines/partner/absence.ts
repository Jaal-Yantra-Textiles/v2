/**
 * When does the model genuinely EXPECT a neighbour on a partner? (#1847)
 *
 * 🔴 An absent edge is an assertion, and the partner spine is where crying
 * wolf would cost most: a partner touches nineteen link files, so a resolver
 * that dashed every empty relation would draw a dozen red edges on a perfectly
 * healthy record and teach the reader to ignore all of them — including the two
 * below, which are the ones worth believing.
 *
 * So the bar is the same one the design spine set: assert an absence only
 * where a real code path is left with nowhere to go. Everything else is a
 * present-only node — there, or simply not drawn.
 *
 * Pure functions with tests rather than inline conditions in the resolver,
 * because both mistakes are silent on screen.
 */

export type RunLike = {
  id: string
  status?: string | null
  partner_id?: string | null
}

/** Run states that mean work was actually delivered and is owed for. */
const DELIVERED = new Set(["completed", "delivered", "approved"])

export const deliveredRuns = (runs: RunLike[]): RunLike[] =>
  runs.filter((r) => DELIVERED.has(String(r.status ?? "")))

/**
 * A partner with nobody who can sign in.
 *
 * 🔴 Unconditional — there is no state in which this is correct. A partner
 * with no `partner_admin` cannot log in, cannot accept a dispatch, and cannot
 * be notified of one; work assigned to them stops dead and the assignment
 * still looks successful from the admin side. It is the partner spine's
 * clearest dead end, and nothing in any list shows it.
 */
export const expectsAdmin = (adminCount: number): boolean => adminCount === 0

/**
 * A partner owed money with no account to send it to.
 *
 * This is the partner spine's `approved_product_id`: the platform records the
 * debt perfectly and the payment has nowhere to land. A payout is paid to an
 * `internal_payment_details` row reached through the partner's
 * `payment_methods` link (see `submission-paid-to-method-link`), so with no
 * method linked an approved submission cannot be paid at all.
 *
 * 🔴 Conditional on there BEING payable work. A partner just onboarded, with
 * no runs and no submissions, owes nothing and expects no bank account — and
 * that is most partners on the day they are created. Asserting it
 * unconditionally would dash an edge on every new partner and make the
 * signal worthless exactly where it matters.
 */
export const expectsPaymentMethod = (
  runs: RunLike[],
  submissionCount: number,
  methodCount: number
): boolean =>
  methodCount === 0 && (submissionCount > 0 || deliveredRuns(runs).length > 0)

/**
 * A seller with no store.
 *
 * `workspace_type` is what the platform routes on: a `seller` gets the
 * commerce surface and is expected to sell through a store of their own. With
 * none linked there is nothing for that surface to act on.
 *
 * 🔴 Only for `seller`. A `manufacturer`, an `individual` and a `designer`
 * produce against someone else's store by design — dashing this on them would
 * assert a defect on the majority of the partner base.
 */
export const expectsStore = (
  workspaceType: string | null | undefined,
  storeCount: number
): boolean => workspaceType === "seller" && storeCount === 0

/**
 * WhatsApp configured but never verified.
 *
 * Not an absent NEIGHBOUR — it is a broken one, and the distinction is the
 * point: the number is there, the notifications are not. Unverified, the
 * WhatsApp sender drops the message, so a dispatch notification is recorded as
 * sent and never arrives. A count of "notifications sent" cannot show it.
 *
 * 🔴 Only when a number is actually set. No number at all is a choice, not a
 * fault.
 */
export const whatsappUnverified = (
  number: string | null | undefined,
  verified: boolean | null | undefined
): boolean => !!number && !verified

/**
 * A custom domain claimed but not verified.
 *
 * Same shape as WhatsApp: the storefront is provisioned, the domain is
 * recorded, and the site does not resolve. It reads as "set up" everywhere the
 * field is displayed.
 */
export const domainUnverified = (
  domain: string | null | undefined,
  verified: boolean | null | undefined
): boolean => !!domain && !verified
