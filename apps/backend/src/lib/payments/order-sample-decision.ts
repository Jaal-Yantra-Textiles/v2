import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { requestOrderBalanceWorkflow } from "../../workflows/payments/request-order-balance"

/**
 * The buyer's verdict on a first sample of a made-to-order deal.
 *
 * A handwoven cloth is woven once as a sample before the run. The deal is
 * struck as "deposit now, balance when you approve the sample" — the
 * `sample_approved` balance trigger. Approval is what releases the balance:
 * it raises it through the same idempotent workflow every other trigger uses.
 * A rejection is recorded and asks for nothing.
 *
 * Every decision is appended to `schedule.metadata.sample_decisions`, so a
 * rejected sample followed by an approved one leaves both on the record.
 */
export type SampleDecision = "approved" | "rejected"

export type DecideOrderSampleInput = {
  order_id: string
  production_run_id: string
  decision: SampleDecision
  notes?: string | null
  /** Admin email or id, for the record. */
  decided_by?: string | null
}

export type DecideOrderSampleResult = {
  order_id: string
  production_run_id: string
  decision: SampleDecision
  payment_schedule_id: string
  balance_raised: boolean
  balance_status: string | null
  pay_url: string | null
  /** Why the balance was not raised on an approval, when it was not. */
  reason: string | null
}

/**
 * Pure guard over what was loaded. Exported for unit tests; throws the error
 * the route surfaces.
 */
export function assertSampleDecisionAllowed(input: {
  order_id: string
  schedule: { balance_trigger?: string | null; deposit_status?: string | null } | null
  run: { run_type?: string | null; order_id?: string | null } | null
  decision: string
}): void {
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "decision must be 'approved' or 'rejected'."
    )
  }
  if (!input.schedule) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${input.order_id} has no payment schedule, so there is no balance a sample could release.`
    )
  }
  if ((input.schedule.balance_trigger ?? "dispatch") !== "sample_approved") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Order ${input.order_id}'s balance is released on '${
        input.schedule.balance_trigger ?? "dispatch"
      }', not on sample approval. Use request_order_balance to raise it by hand.`
    )
  }
  if (!input.run) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Production run not found.")
  }
  if (input.run.run_type !== "sample") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "That run is a production run, not a sample. Approve the SAMPLE run the buyer saw."
    )
  }
  if (input.run.order_id !== input.order_id) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `That sample run belongs to ${
        input.run.order_id ? `order ${input.run.order_id}` : "no order"
      }, not ${input.order_id}. Create the sample run with this order's id.`
    )
  }
}

export async function decideOrderSample(
  container: any,
  input: DecideOrderSampleInput
): Promise<DecideOrderSampleResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
  const runs: any = container.resolve(PRODUCTION_RUNS_MODULE)

  const schedule = await schedules.findByOrderId(input.order_id).catch(() => null)
  const run = await runs
    .retrieveProductionRun(input.production_run_id)
    .catch(() => null)

  assertSampleDecisionAllowed({
    order_id: input.order_id,
    schedule,
    run,
    decision: input.decision,
  })

  const now = new Date()
  const history = Array.isArray(schedule.metadata?.sample_decisions)
    ? schedule.metadata.sample_decisions
    : []
  const entry = {
    production_run_id: input.production_run_id,
    decision: input.decision,
    notes: input.notes ?? null,
    decided_by: input.decided_by ?? null,
    decided_at: now.toISOString(),
  }

  await schedules.updatePaymentSchedules({
    id: schedule.id,
    metadata: { ...(schedule.metadata ?? {}), sample_decisions: [...history, entry] },
    ...(input.decision === "approved"
      ? {
          // The FIRST approval is the one that released the money; a repeat
          // keeps its timestamp.
          sample_approved_at: schedule.sample_approved_at ?? now,
          sample_run_id: schedule.sample_run_id ?? input.production_run_id,
        }
      : {}),
  })

  if (input.decision === "rejected") {
    logger?.info?.(
      `[sample] order=${input.order_id} run=${input.production_run_id} REJECTED — balance stays ${schedule.balance_status}`
    )
    return {
      order_id: input.order_id,
      production_run_id: input.production_run_id,
      decision: "rejected",
      payment_schedule_id: schedule.id,
      balance_raised: false,
      balance_status: schedule.balance_status ?? null,
      pay_url: null,
      reason: "A rejected sample releases nothing.",
    }
  }

  const { result } = await requestOrderBalanceWorkflow(container).run({
    input: {
      order_id: input.order_id,
      requested_by: input.decided_by ?? "sample_approval",
    },
  })
  const out = result as any
  const after = await schedules.findByOrderId(input.order_id).catch(() => null)

  if (out?.raised) {
    try {
      const eventBus: any = container.resolve(Modules.EVENT_BUS)
      await eventBus.emit({
        name: "order.balance_due",
        data: {
          id: input.order_id,
          order_id: input.order_id,
          payment_schedule_id: schedule.id,
          amount: out.plan?.collectable ? out.plan.amount : null,
          currency_code: out.plan?.collectable ? out.plan.currency_code : null,
          pay_url: out.pay_url ?? null,
          trigger: "sample_approved",
        },
      })
    } catch (e: any) {
      logger?.warn?.(`[sample] balance_due emit failed for ${input.order_id}: ${e?.message ?? e}`)
    }
  }

  logger?.info?.(
    `[sample] order=${input.order_id} run=${input.production_run_id} APPROVED — balance ${
      out?.raised ? `raised, link ${out.pay_url}` : `not raised: ${out?.plan?.reason}`
    }`
  )

  return {
    order_id: input.order_id,
    production_run_id: input.production_run_id,
    decision: "approved",
    payment_schedule_id: schedule.id,
    balance_raised: !!out?.raised,
    balance_status: after?.balance_status ?? null,
    pay_url: out?.pay_url ?? null,
    reason: out?.raised ? null : out?.plan?.reason ?? null,
  }
}
