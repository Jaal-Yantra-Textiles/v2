import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"
import { createPartnerNotification } from "../../../lib/notifications/create-partner-notification"

/**
 * Tell the partner that their proposed inventory-order change was decided.
 *
 * 🔴 Before this, approve and reject told NOBODY. Neither route emitted an
 * event, neither workflow created a notification, and no subscriber listened —
 * the partner's only signal was that the pending banner stopped rendering the
 * next time they happened to reopen the order. A proposal could sit decided for
 * days with the partner still believing their payment was on hold, because the
 * thing that unblocks their money is invisible from their side.
 *
 * A rejection is the worse half: it carries a REASON an operator typed for the
 * partner to read, and there was no path by which they would ever read it.
 *
 * Channel is the in-app bell (`feed`, scoped by `receiver_id = partner.id`, the
 * route being `GET /partners/notifications`). Deliberately not email: the email
 * path compiles a template row out of the DB and skips quietly when that row is
 * missing, so it would ship as a silent no-op until someone seeded prod. The
 * bell needs no template and works the moment this deploys. Email can be added
 * on top once a template exists.
 *
 * Notifications are observability, not causation: `createPartnerNotification`
 * swallows its own failures, and this step has no compensation, because
 * un-sending a notification about a decision that DID happen would be a lie.
 */
export type NotifyPartnerOfChangeDecisionInput = {
  orderId: string
  changeId: string
  decision: "approved" | "rejected"
  /** The partner who submitted the proposal, when the caller already knows it. */
  partnerId?: string | null
  /** Operator's reason, shown on a rejection. */
  reason?: string | null
}

/**
 * Who to tell. `change.submitted_by` is written at staging and is the partner
 * that actually proposed this; the order's linked partner is the fallback for a
 * row staged before that field existed, or re-assigned since.
 */
const resolvePartnerId = async (
  container: any,
  orderId: string,
  changeId: string,
  hint?: string | null
): Promise<string | null> => {
  if (hint) {
    return hint
  }
  try {
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    const change = await service.retrieveOrderChange(changeId)
    if (change?.submitted_by) {
      return String(change.submitted_by)
    }
  } catch {
    /* fall through to the order's partner */
  }
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "partner.id"],
      filters: { id: orderId },
    })
    return data?.[0]?.partner?.id ?? null
  } catch {
    return null
  }
}

/**
 * ONE shape on every branch. Two different object literals made the step's
 * return type a union, which `createStep` cannot infer an `InvokeFn` from — so
 * the step silently typed as taking no arguments and the call site failed with
 * "Expected 0 arguments, but got 1". The integration tests passed throughout,
 * because jest transpiles without typechecking; only `medusa build` saw it.
 */
export type NotifyPartnerOfChangeDecisionResult = {
  notified: boolean
  partner_id: string | null
  /** Why nothing was sent, when nothing was. */
  skipped_reason: string | null
}

export const notifyPartnerOfChangeDecisionStep = createStep(
  "notify-partner-of-inventory-order-change-decision",
  async (input: NotifyPartnerOfChangeDecisionInput, { container }) => {
    const partnerId = await resolvePartnerId(
      container,
      input.orderId,
      input.changeId,
      input.partnerId
    )
    if (!partnerId) {
      return new StepResponse<NotifyPartnerOfChangeDecisionResult, null>(
        { notified: false, partner_id: null, skipped_reason: "no partner" },
        null
      )
    }

    const approved = input.decision === "approved"
    const reason = (input.reason ?? "").trim()

    const sent = await createPartnerNotification(container, {
      partner_id: partnerId,
      title: approved
        ? "Your order changes were approved"
        : "Your order changes were not approved",
      description: approved
        ? "The quantities, prices and tax you proposed are now on the order, and your payment claim is no longer on hold."
        : reason
          ? `Reason: ${reason}`
          : "No reason was given. You can propose a fresh set of changes.",
      /**
       * `/inventory-orders/:id` is the legacy-id deep link the partner
       * dashboard keeps alive on purpose — `inventory-order-redirect` resolves
       * it to the unified order and redirects. Linking the unified id directly
       * would mean resolving the order↔inventory_order link here, and getting
       * it wrong is #2114 all over again.
       */
      url: `/inventory-orders/${input.orderId}`,
      resource_type: "inventory_order",
      resource_id: input.orderId,
      trigger_type: approved
        ? "inventory_order_change.approved"
        : "inventory_order_change.rejected",
      // One bell row per decision, however often the workflow is retried.
      idempotency_key: `inventory-order-change-${input.decision}:${input.changeId}`,
      data: { change_id: input.changeId, decision: input.decision },
    })

    return new StepResponse<NotifyPartnerOfChangeDecisionResult, null>(
      { notified: sent, partner_id: partnerId, skipped_reason: null },
      null
    )
  }
)
