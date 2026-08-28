import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { LinkDefinition } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"

import { INTERNAL_PAYMENTS_MODULE } from "../../../../modules/internal_payments"
import { ORDER_INVENTORY_MODULE } from "../../../../modules/inventory_orders"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — draw the edge from a payment to the inventory order it paid
 * for, for the payouts approved BEFORE that edge existed (#1622).
 *
 * `links/inventory-orders-internal-payments.ts` was declared long ago and
 * nothing ever wrote it. #1621 wired `linkPaymentToInventoryOrderStep` into
 * approval, so every payout approved from then on draws its own edge — but the
 * payouts already approved keep showing no payment on their order.
 *
 * ⚠️ It records something that ALREADY HAPPENED. It creates no submission,
 * approves nothing, changes no amount, and moves no money. It draws a
 * navigational edge between two rows that already exist.
 *
 * ## It transcribes; it does not deduce
 *
 * 🔴 The order comes from the submission's OWN LINES — `inventory_order_id` on
 * `payment_submission_item`, which the create path wrote at the time. It is
 * never guessed from an amount that happens to match, or from a partner who
 * happens to have one open order. A wrong edge here says a specific order was
 * paid for when it was not, which is worse than no edge at all: an absent edge
 * is visibly absent, while a wrong one reads as fact.
 *
 * 🔴 A submission naming SEVERAL inventory orders links its payment to each of
 * them. That is deliberate and matches what approval now does — the payment
 * genuinely paid for all of them, and reconciliation already records such a
 * payout as `mixed` with a null source precisely because no single one is the
 * answer. Linking to only the first would make the rest invisible again.
 *
 * A submission with no payment record yet (Draft, Pending, Rejected) is
 * SKIPPED, not linked: the link is payment→order, and there is no payment.
 *
 * Never duplicates an edge that already exists — `link.create` is NOT
 * idempotent, so every candidate is checked against the order's existing
 * payments first. Safe to re-run.
 */
const paramsSchema = z.object({
  /** One submission, for a spot check before a full pass. */
  payment_submission_id: z.string().min(1).optional(),
  /** Bound a first pass; omitted means every payout that needs one. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

export const backfillInventoryOrderPaymentLinksJob: MaintenanceJob = {
  id: "backfill-inventory-order-payment-links",
  label: "Link existing payouts to the inventory orders they paid for",
  description:
    "Draw the missing payment→inventory-order edge for payouts approved before #1621 wired it into approval. links/inventory-orders-internal-payments.ts was declared long ago and nothing ever wrote it, so an inventory order paid for earlier shows no payment on its own page. The order is read from the submission's own lines (payment_submission_item.inventory_order_id), never guessed from a matching amount or a partner's open orders — a wrong edge claims a specific order was paid for and reads as fact, which is worse than an absent one. A submission naming several inventory orders links its payment to each, matching what approval now does. A submission with no payment record yet (Draft, Pending, Rejected) is skipped rather than linked, because the edge is payment→order and there is no payment. Records something that already happened: creates no submission, approves nothing, changes no amount, moves no money. Never duplicates an existing edge — link.create is not idempotent, so each candidate is checked against the order's current payments first. Safe to re-run.",
  params: [
    {
      name: "payment_submission_id",
      type: "string",
      required: false,
      description: "Only this submission, e.g. for a spot check before a full pass.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Stop after this many edges. Omit for every one that is missing.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }

    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    /**
     * Lines that name an inventory order. Read from the LINE, which is where
     * the create path recorded it — the reconciliation record collapses a
     * multi-source payout to `mixed` with a null source and cannot answer this.
     */
    const items = (await (service as any).listPaymentSubmissionItems(
      parsed.data.payment_submission_id
        ? { submission_id: parsed.data.payment_submission_id }
        : {},
      { relations: ["submission"], take: null }
    )) as any[]

    if (parsed.data.payment_submission_id && !(items || []).length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission ${parsed.data.payment_submission_id} has no line items`
      )
    }

    const withOrder = (items || []).filter((i) => !!i?.inventory_order_id)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    /** Named an order but the payout has no payment record yet. */
    const noPayment: Array<{ submission_id: string; status: string }> = []
    /**
     * Named an order and the payment lookup COULD NOT ANSWER. Kept apart from
     * `noPayment` deliberately: reporting ignorance as "no payment" is how a
     * report-only job turns into a wrong instruction.
     */
    const unresolved: Array<{ submission_id: string; status: string }> = []
    let alreadyLinked = 0

    /** submission id → its payment ids, resolved once per submission. */
    const paymentsBySubmission = new Map<string, string[]>()
    /** inventory order id → the payment ids already linked to it. */
    const linkedByOrder = new Map<string, Set<string>>()

    /**
     * 🔴 `null` means COULD NOT LOOK; `[]` means looked and found none.
     *
     * The first dry-run on production reported all four payouts as "no payment
     * record yet" — including GOF, whose ₹30,000 payment demonstrably exists.
     * The cause is the trap this codebase keeps hitting: on `query.graph` an
     * UNKNOWN relation is silently DROPPED, so the key is simply absent, while
     * a real-but-empty one returns `[]`. Reading `data?.[0]?.payments` collapsed
     * those two into "no payments", and the job then reported ignorance as an
     * answer — the exact shape of #1557 and #1565.
     *
     * ⚠️ The module registers as `payment_submissions` (plural) — see the
     * working graph calls in `workflows/whatsapp/*` — while the MODEL is
     * `payment_submission`. The singular resolved without throwing and returned
     * rows carrying no `payments` key at all, which is why this looked like a
     * data answer rather than a spelling mistake.
     */
    const paymentsFor = async (
      submissionId: string
    ): Promise<string[] | null> => {
      if (paymentsBySubmission.has(submissionId)) {
        return paymentsBySubmission.get(submissionId)!
      }

      const read = async (entity: string): Promise<string[] | null> => {
        try {
          const { data } = await query.graph({
            entity,
            fields: ["id", "payments.id"],
            filters: { id: submissionId },
          })
          const node = (data || [])[0]
          if (!node) return null
          // Key ABSENT — the relation was dropped, so this is ignorance.
          if (!("payments" in node)) return null

          const raw = (node as any).payments
          return (!raw ? [] : Array.isArray(raw) ? raw : [raw])
            .map((p: any) => p?.id)
            .filter(Boolean) as string[]
        } catch {
          return null
        }
      }

      // Plural first: it is the spelling the working graph calls in this
      // codebase use. The singular is tried only as a fallback.
      const ids = (await read("payment_submissions")) ?? (await read("payment_submission"))

      if (ids) paymentsBySubmission.set(submissionId, ids)
      return ids
    }

    const linkedFor = async (orderId: string): Promise<Set<string>> => {
      if (linkedByOrder.has(orderId)) return linkedByOrder.get(orderId)!
      const { data } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "internal_payments.id"],
        filters: { id: orderId },
      })
      const raw = (data || [])[0]?.internal_payments
      const ids = new Set(
        (!raw ? [] : Array.isArray(raw) ? raw : [raw])
          .map((p: any) => p?.id)
          .filter(Boolean) as string[]
      )
      linkedByOrder.set(orderId, ids)
      return ids
    }

    for (const item of withOrder) {
      if (parsed.data.limit && changes.length >= parsed.data.limit) break

      const submissionId = String(
        item?.submission?.id || item?.submission_id || ""
      )
      const orderId = String(item.inventory_order_id)

      try {
        const paymentIds = submissionId ? await paymentsFor(submissionId) : []

        /**
         * 🔴 COULD NOT LOOK. Never reported as "no payment": that is ignorance
         * presented as a finding, and it would tell a reader this payout has no
         * payment record when the truth is that the query could not answer.
         */
        if (paymentIds === null) {
          unresolved.push({
            submission_id: submissionId || "(unknown)",
            status: String(item?.submission?.status || "unknown"),
          })
          continue
        }

        if (!paymentIds.length) {
          /**
           * Looked, and there is genuinely no payment yet. Reported rather than
           * silently dropped: a Pending payout naming an order is a real state,
           * and a reader must not mistake this job's silence for "already
           * linked".
           */
          noPayment.push({
            submission_id: submissionId || "(unknown)",
            status: String(item?.submission?.status || "unknown"),
          })
          continue
        }

        const existing = await linkedFor(orderId)

        for (const paymentId of paymentIds) {
          if (existing.has(paymentId)) {
            alreadyLinked++
            continue
          }

          changes.push({
            entity: "inventory_order_internal_payment_link",
            id: `${orderId}:${paymentId}`,
            field: "link",
            before: null,
            after: { inventory_order_id: orderId, payment_id: paymentId },
          })

          if (!dry_run) {
            const link: LinkDefinition = {
              [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
              [INTERNAL_PAYMENTS_MODULE]: { internal_payments_id: paymentId },
            }
            await remoteLink.create([link])
            // Keep the in-memory view honest so a second line naming the same
            // order in this same pass does not write the edge twice.
            existing.add(paymentId)
          }
        }
      } catch (e: any) {
        // One unlinkable payout must not strand the rest of the pass.
        errors.push({
          id: `${submissionId}:${orderId}`,
          message: e?.message ?? String(e),
        })
      }
    }

    const parts: string[] = []
    parts.push(
      changes.length
        ? `${dry_run ? "Would link" : "Linked"} ${changes.length} payment(s) to the inventory order(s) they paid for: ${changes
            .map((c) => c.id)
            .join("; ")}`
        : "No inventory order is missing its payment link"
    )
    if (noPayment.length) {
      parts.push(
        `${noPayment.length} line(s) name an inventory order but their payout has no payment record yet — nothing to link: ${noPayment
          .map((n) => `${n.submission_id} (${n.status})`)
          .join(", ")}`
      )
    }
    if (unresolved.length) {
      parts.push(
        `🔴 ${unresolved.length} line(s) COULD NOT BE RESOLVED — the payment lookup returned no answer, which is NOT the same as "no payment". These may well have payments and are not covered by this run: ${unresolved
          .map((n) => `${n.submission_id} (${n.status})`)
          .join(", ")}`
      )
    }
    if (alreadyLinked) {
      parts.push(`${alreadyLinked} edge(s) already exist`)
    }

    return {
      job_id: "backfill-inventory-order-payment-links",
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: parts.join(". ") + ".",
      changes,
      errors,
    }
  },
}
