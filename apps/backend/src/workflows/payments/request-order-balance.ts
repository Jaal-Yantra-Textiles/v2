import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createOrUpdateOrderPaymentCollectionWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/core-flows"

import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import {
  buildBalancePayUrl,
  planBalanceCollection,
  type BalancePlan,
} from "../../lib/payments/balance-collection"

/**
 * Raise the balance on an order and mint the link that collects it.
 *
 * ## The activation
 *
 * A partner working the order presses this when the goods are made and moving.
 * That is deliberate: the balance becomes payable when the goods exist, and the
 * people who know that are the makers. Several partners may be realising one
 * order, so any of them may raise it — and raising it twice is harmless,
 * because both the plan and the service refuse a balance that is already paid.
 *
 * ## What it creates
 *
 * A SECOND payment collection on the order, for the balance only, with its own
 * Stripe session. Not a capture of a held authorisation: an online card auth
 * lasts about seven days and a made-to-order lead time does not, which is why
 * the schedule was designed as two charges from the start.
 *
 * 🔴 It is idempotent on the collection. A partner pressing twice, or two
 * partners on one order pressing at once, must not mint two collections and
 * two intents against the same buyer — the existing balance collection is
 * reused when its amount agrees, and a disagreement REFUSES rather than
 * picking one of two figures.
 */
export type RequestOrderBalanceInput = {
  order_id: string
  /** Who asked, for the audit line. A partner id, or "admin". */
  requested_by?: string | null
}

export type RequestOrderBalanceResult = {
  raised: boolean
  plan: BalancePlan
  payment_collection_id: string | null
  pay_url: string | null
  /** Already-raised balances return the existing link rather than a new one. */
  reused: boolean
}

const loadScheduleStep = createStep(
  "load-schedule-for-balance",
  async (input: RequestOrderBalanceInput, { container }) => {
    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByOrderId(input.order_id)
    const plan = planBalanceCollection(schedule)
    return new StepResponse({ plan, schedule: schedule ?? null })
  }
)

const ensureBalanceCollectionStep = createStep(
  "ensure-balance-payment-collection",
  async (
    input: { plan: BalancePlan; requested_by?: string | null },
    { container }
  ) => {
    if (!input.plan.collectable) {
      // Not an error: a refusal is reported to the caller, which is what lets a
      // partner see "already paid" rather than a 500.
      return new StepResponse({ payment_collection_id: null, reused: false })
    }

    const { schedule_id, order_id, amount } = input.plan
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

    /**
     * 🔑 Core already models the balance: `summary.pending_difference` is what
     * the ORDER says is still owed, and
     * `createOrUpdateOrderPaymentCollectionWorkflow` creates a collection for
     * exactly that — skipping any collection that is already `completed`, which
     * the deposit's is. So the deposit is left alone and a SECOND collection
     * appears for the remainder, with core's own order↔collection link.
     *
     * This replaced a hand-rolled `createPaymentCollections` + `link.create`.
     * Found by reading the docs, not the source — the same way #1451's refresh
     * trap was found.
     */
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "summary", "currency_code"],
      filters: { id: order_id },
    })
    const order = orders?.[0] as any
    const pending = Number(order?.summary?.pending_difference)

    if (!Number.isFinite(pending)) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Order ${order_id} reports no pending difference, so the balance cannot be verified before charging.`
      )
    }

    /**
     * 🔴 Two sources of truth, reconciled before any money is asked for.
     *
     * The SCHEDULE holds what was agreed; the ORDER holds what is outstanding
     * after any edit, refund or extra capture. They agree on a normal deal and
     * disagreeing means something happened that nobody has reasoned about —
     * an order edit after a deposit, say. Charging either figure silently is
     * how a buyer is billed for a number no one chose, so this refuses and
     * names both.
     *
     * ⚠️ Core's own guard only catches `amount > pending`. It would happily let
     * an agreed balance SMALLER than pending through and then charge the larger
     * pending figure, which is the overcharge direction.
     */
    if (Math.round(pending * 100) !== Math.round(amount * 100)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Order ${order_id} has ${pending} outstanding but its payment schedule says the balance is ${amount}. Refusing rather than charging either figure — reconcile the order and the schedule first.`
      )
    }

    const { result } = await createOrUpdateOrderPaymentCollectionWorkflow(
      container
    ).run({ input: { order_id, amount } })

    const collection: any = Array.isArray(result) ? result[0] : result

    logger?.info?.(
      `[balance] order=${order_id} schedule=${schedule_id} collection=${
        collection?.id
      } for ${amount} — requested_by=${input.requested_by ?? "unknown"}`
    )

    return new StepResponse({
      payment_collection_id: collection?.id ?? null,
      reused: false,
    })
  }
)

const ensureBalanceSessionStep = createStep(
  "ensure-balance-payment-session",
  async (
    input: { payment_collection_id: string | null; plan: BalancePlan },
    { container }
  ) => {
    if (!input.payment_collection_id || !input.plan.collectable) {
      return new StepResponse({ ok: false })
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: collections } = await query.graph({
      entity: "payment_collection",
      fields: ["id", "payment_sessions.id", "payment_sessions.provider_id"],
      filters: { id: input.payment_collection_id },
    })

    const sessions = (collections?.[0] as any)?.payment_sessions ?? []
    if (sessions.some((s: any) => String(s?.provider_id ?? "").includes("stripe"))) {
      return new StepResponse({ ok: true })
    }

    /**
     * Session creation is best-effort. The hosted page creates one on demand if
     * this fails, and a raised balance with no session yet is recoverable —
     * whereas failing the whole activation would leave the schedule unraised
     * and the partner with nothing to send.
     */
    try {
      await createPaymentSessionsWorkflow(container).run({
        input: {
          payment_collection_id: input.payment_collection_id,
          provider_id: "pp_stripe_stripe",
        },
      })
      return new StepResponse({ ok: true })
    } catch {
      return new StepResponse({ ok: false })
    }
  }
)

const markDueStep = createStep(
  "mark-balance-due",
  async (
    input: { plan: BalancePlan },
    { container }
  ): Promise<StepResponse<{ raised: boolean; pay_url: string | null }>> => {
    // Typed explicitly: without it the first return pins `pay_url` to `null`
    // and the string return below stops assigning.
    if (!input.plan.collectable) {
      return new StepResponse({ raised: false, pay_url: null })
    }

    /**
     * The link is built HERE, where the schedule id is known, and stored on the
     * schedule as `balance_link_ref` — so the URL the buyer was sent and the
     * URL we think we sent are the same string, recoverable later from the row
     * rather than reconstructed from env at read time.
     */
    const backendUrl =
      process.env.MEDUSA_BACKEND_URL ||
      process.env.BACKEND_URL ||
      "https://v3.jaalyantra.com"
    const payUrl = buildBalancePayUrl(backendUrl, input.plan.schedule_id)

    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
    // Idempotent in the service: an already-`due` schedule keeps its original
    // `balance_due_at` rather than having the clock reset by a second press.
    await schedules.markBalanceDue(input.plan.schedule_id, payUrl)
    return new StepResponse({ raised: true, pay_url: payUrl })
  }
)

export const requestOrderBalanceWorkflow = createWorkflow(
  { name: "request-order-balance", store: true },
  (input: RequestOrderBalanceInput) => {
    const loaded = loadScheduleStep(input)

    const collection = ensureBalanceCollectionStep({
      plan: loaded.plan,
      requested_by: input.requested_by,
    })

    ensureBalanceSessionStep({
      payment_collection_id: collection.payment_collection_id,
      plan: loaded.plan,
    })

    const marked = markDueStep({ plan: loaded.plan })

    return new WorkflowResponse({
      plan: loaded.plan,
      payment_collection_id: collection.payment_collection_id,
      reused: collection.reused,
      raised: marked.raised,
      pay_url: marked.pay_url,
    })
  }
)

export { buildBalancePayUrl }
export default requestOrderBalanceWorkflow
