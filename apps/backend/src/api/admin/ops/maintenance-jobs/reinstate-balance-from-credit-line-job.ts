import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PAYMENT_SCHEDULE_MODULE } from "../../../../modules/payment_schedule"
import {
  planReinstate,
  REVERSAL_REFERENCE,
  reversalRefId,
} from "./reinstate-balance-from-credit-line-lib"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Undo a credit line that should have been a deposit (order #176, 2026-11-26).
 *
 * A 50% deposit was charged in full (fixed in the payment-sessions route).
 * The admin then refunded part of it with "Pricing Error", which Medusa books
 * as a CREDIT LINE: the order total drops to what was kept, the order reads
 * fully paid, and the balance can never be raised.
 *
 * This adds an OFFSETTING negative credit line through Medusa's own order
 * change (createOrderChange -> addOrderAction CREDIT_LINE_ADD ->
 * confirmOrderChange), so the original stays in the history and Medusa
 * recomputes the totals. Core's createOrderCreditLinesWorkflow cannot do it:
 * it refuses any credit line while the order's pending difference is 0.
 *
 * Then the schedule says what the money says: deposit = net paid, balance =
 * total - net paid, still `not_due` (raise it later as usual). Moves no money,
 * sends nothing. Preview (default) writes nothing; a second run is refused.
 */
const paramsSchema = z.object({
  order_id: z.string().trim().min(1),
  credit_line_id: z.string().trim().min(1),
})

const r2 = (n: number) => Math.round(n * 100) / 100

export const reinstateBalanceFromCreditLineJob: MaintenanceJob = {
  id: "reinstate-balance-from-credit-line",
  label: "Turn a refund credit line back into a balance owed",
  description:
    "For a deposit order that was charged in full and then part-refunded with a reason that booked a CREDIT LINE (order total dropped, order reads fully paid, balance can never be raised — prod #176). Adds an offsetting negative credit line through a Medusa order change (history kept, totals recomputed), then sets the payment schedule to deposit = net paid, balance = total - net paid, balance still not_due. Moves no money and sends nothing. REFUSES a cancelled order, a credit line not on the order or already reversed, a missing schedule, a balance already raised/paid, or nothing owed. Preview (default) writes nothing.",
  params: [
    { name: "order_id", type: "string", required: true, description: "The order (`order_...`)" },
    {
      name: "credit_line_id",
      type: "string",
      required: true,
      description: "The credit line to reverse (`ordcl_...`), from get_order.credit_lines",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { order_id, credit_line_id } = parsed.data
    const job_id = "reinstate-balance-from-credit-line"

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderModule: any = container.resolve(Modules.ORDER)
    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)

    const readOrder = async () =>
      (
        await query.graph({
          entity: "order",
          fields: [
            "id",
            "status",
            "version",
            "currency_code",
            "total",
            "summary",
            "credit_lines.id",
            "credit_lines.amount",
            "credit_lines.reference",
            "credit_lines.reference_id",
            "payment_collections.captured_amount",
            "payment_collections.refunded_amount",
          ],
          filters: { id: order_id },
        })
      ).data?.[0]

    const order = await readOrder()
    if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${order_id} not found`)

    const captured = (order.payment_collections ?? []).reduce(
      (s: number, c: any) => s + (Number(c?.captured_amount) || 0),
      0
    )
    const refunded = (order.payment_collections ?? []).reduce(
      (s: number, c: any) => s + (Number(c?.refunded_amount) || 0),
      0
    )
    const schedule = await schedules.findByOrderId(order_id).catch(() => null)

    const plan = planReinstate({
      order: {
        id: order.id,
        status: order.status,
        total: Number(order.total),
        credit_lines: (order.credit_lines ?? []).map((c: any) => ({
          id: c.id,
          amount: Number(c.amount),
          reference: c.reference,
          reference_id: c.reference_id,
        })),
        captured,
        refunded,
      },
      credit_line_id,
      schedule: schedule
        ? {
            id: schedule.id,
            deposit_status: schedule.deposit_status,
            balance_status: schedule.balance_status,
            total_due: Number(schedule.total_due),
            deposit_amount: Number(schedule.deposit_amount),
            balance_amount: schedule.balance_amount == null ? null : Number(schedule.balance_amount),
          }
        : null,
    })

    if (!plan.ok) {
      return { job_id, dry_run, applied: false, summary: `REFUSED: ${plan.reason}`, changes: [] }
    }

    const cur = String(order.currency_code).toUpperCase()
    const changes: MaintenanceChange[] = [
      {
        entity: "order_credit_line",
        id: credit_line_id,
        field: "reversal",
        before: plan.reverse_amount,
        after: -plan.reverse_amount,
        note: `An offsetting credit line (${REVERSAL_REFERENCE}) is added; the original stays.`,
      },
      { entity: "order", id: order_id, field: "total", before: plan.total_before, after: plan.total_after },
      {
        entity: "order",
        id: order_id,
        field: "summary.pending_difference",
        before: Number(order.summary?.pending_difference ?? 0),
        after: plan.balance,
      },
      {
        entity: "payment_schedule",
        id: plan.schedule_update.id,
        field: "deposit_amount",
        before: schedule.deposit_amount,
        after: plan.net_paid,
        note: `Net paid: captured ${r2(captured)} - refunded ${r2(refunded)}.`,
      },
      {
        entity: "payment_schedule",
        id: plan.schedule_update.id,
        field: "balance_amount",
        before: schedule.balance_amount,
        after: plan.balance,
        note: "Still not_due: raise it the usual way when the time comes.",
      },
    ]

    if (dry_run) {
      return {
        job_id,
        dry_run,
        applied: false,
        summary:
          `Would reverse the ${plan.reverse_amount} ${cur} credit line: order total ${plan.total_before} → ${plan.total_after}, ` +
          `deposit = ${plan.net_paid} paid, balance ${plan.balance} owed (not due yet). No money moves.`,
        changes,
      }
    }

    const change = await orderModule.createOrderChange({
      order_id,
      change_type: "credit_line",
      internal_note: `Reverse credit line ${credit_line_id}: it was a deposit refund, not a discount (#176).`,
    })
    await orderModule.addOrderAction({
      order_change_id: change.id,
      order_id,
      version: change.version,
      action: "CREDIT_LINE_ADD",
      reference: REVERSAL_REFERENCE,
      reference_id: reversalRefId(credit_line_id),
      amount: -plan.reverse_amount,
    })
    await orderModule.confirmOrderChange([{ id: change.id }])

    // Prove the order moved BEFORE touching the schedule: a reversal that
    // didn't take must not leave a schedule claiming a balance the order
    // doesn't owe.
    const reversed = await readOrder()
    const totalNow = r2(Number(reversed.total))
    const owedNow = r2(Number(reversed.summary?.pending_difference ?? NaN))
    if (totalNow !== plan.total_after || owedNow !== plan.balance) {
      return {
        job_id,
        dry_run,
        applied: true,
        summary:
          `⚠️ CHECK BY HAND: the credit-line reversal did not land as planned (order total ${totalNow}, owed ${owedNow}; ` +
          `expected ${plan.total_after} / ${plan.balance}). The payment schedule was NOT changed.`,
        changes,
      }
    }

    await schedules.updatePaymentSchedules({
      id: plan.schedule_update.id,
      total_due: plan.schedule_update.total_due,
      deposit_amount: plan.schedule_update.deposit_amount,
      balance_amount: plan.schedule_update.balance_amount,
    })

    // Read it back: the response is not the record.
    const after = await readOrder()
    const scheduleAfter = await schedules.findByOrderId(order_id)
    const totalAfter = Number(after.total)
    const owedAfter = Number(after.summary?.pending_difference ?? NaN)
    const ok = r2(totalAfter) === plan.total_after && r2(owedAfter) === plan.balance
    return {
      job_id,
      dry_run,
      applied: true,
      summary:
        `${ok ? "Done" : "⚠️ CHECK BY HAND"}: order total now ${totalAfter} ${cur}, owed ${owedAfter}; ` +
        `schedule deposit ${Number(scheduleAfter?.deposit_amount)} (${scheduleAfter?.deposit_status}), ` +
        `balance ${Number(scheduleAfter?.balance_amount)} (${scheduleAfter?.balance_status}).`,
      changes,
    }
  },
}
