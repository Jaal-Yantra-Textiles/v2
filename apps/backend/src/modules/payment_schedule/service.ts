import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import PaymentSchedule from "./models/payment-schedule"
import { resolveDepositPct, splitDeposit } from "./lib/split"

/**
 * The deposit/balance ledger (#1439 S11, #959 Slice C).
 *
 * Everything money-shaped goes through here rather than through raw
 * `createPaymentSchedules` calls at the call site, so the split arithmetic and
 * the "does it add up" check live in one place.
 */
class PaymentScheduleService extends MedusaService({ PaymentSchedule }) {
  /**
   * Open a schedule for a cart.
   *
   * The percentage is resolved by `resolveDepositPct` (deal → partner → 30%)
   * and the split by `splitDeposit`, which guarantees the two amounts add back
   * to the total. Nothing here trusts a caller-supplied deposit amount, because
   * a caller that has already done the arithmetic is a caller that can disagree
   * with the ledger.
   */
  async openForCart(input: {
    cart_id: string
    currency_code: string
    total_due: number
    source_type?: "quote" | "catalog_mto" | "manual"
    source_id?: string | null
    rail?: "payu" | "stripe" | "manual"
    quote_deposit_pct?: number | null
    partner_deposit_pct?: number | null
    metadata?: Record<string, any> | null
  }) {
    if (!input.cart_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A payment schedule needs the cart it is for"
      )
    }

    const pct = resolveDepositPct(input.quote_deposit_pct, input.partner_deposit_pct)
    const split = splitDeposit(input.total_due, pct)

    const created: any = await this.createPaymentSchedules([
      {
        cart_id: input.cart_id,
        order_id: null,
        source_type: input.source_type ?? "quote",
        source_id: input.source_id ?? null,
        currency_code: input.currency_code,
        total_due: input.total_due,
        deposit_pct: split.deposit_pct,
        deposit_amount: split.deposit_amount,
        deposit_status: "pending",
        balance_amount: split.balance_amount,
        balance_status: "not_due",
        rail: input.rail ?? "manual",
        metadata: input.metadata ?? null,
      },
    ] as any)

    // The generated create accepts an array and returns one; its TYPE says a
    // single row. Normalising here rather than destructuring keeps both true.
    return Array.isArray(created) ? created[0] : created
  }

  /** The schedule for a cart, or null. One schedule per cart by construction. */
  async findByCartId(cart_id: string) {
    if (!cart_id) {
      // 🔑 An absent id must never read as "no filter" — that is how a public
      // route ended up pricing freight from every tenant's stock locations
      // (#1433). A missing id has exactly one honest answer: nothing.
      return null
    }
    const rows = await this.listPaymentSchedules({ cart_id } as any, { take: 1 })
    return rows?.[0] ?? null
  }

  /** The schedule for an order, or null. */
  async findByOrderId(order_id: string) {
    if (!order_id) {
      return null
    }
    const rows = await this.listPaymentSchedules({ order_id } as any, { take: 1 })
    return rows?.[0] ?? null
  }

  /**
   * Record that the deposit landed.
   *
   * Idempotent on purpose: a gateway webhook is delivered at least once, and
   * the second delivery must not move `deposit_paid_at` or re-fire anything
   * downstream. A lock released before the effect is a mutex, not idempotency
   * (#1334) — so the guard is the state itself.
   */
  async markDepositPaid(id: string, ref?: string | null) {
    const schedule: any = await this.retrievePaymentSchedule(id)
    if (schedule.deposit_status === "paid") {
      return schedule
    }
    return await this.updatePaymentSchedules({
      id,
      deposit_status: "paid",
      deposit_paid_at: new Date(),
      ...(ref ? { deposit_ref: ref } : {}),
    } as any)
  }

  /**
   * Raise the balance — the production/delivery event happened.
   *
   * Refuses on an unpaid deposit rather than quietly proceeding: asking for the
   * balance on a deal whose deposit never landed is a demand for money against
   * nothing, and the state that produced it is worth surfacing loudly.
   */
  async markBalanceDue(id: string, link_ref?: string | null) {
    const schedule: any = await this.retrievePaymentSchedule(id)
    if (schedule.deposit_status !== "paid" && schedule.deposit_status !== "waived") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cannot raise the balance on schedule ${id}: the deposit is ${schedule.deposit_status}`
      )
    }
    if (schedule.balance_status === "paid" || schedule.balance_status === "waived") {
      return schedule
    }
    return await this.updatePaymentSchedules({
      id,
      balance_status: "due",
      balance_due_at: schedule.balance_due_at ?? new Date(),
      ...(link_ref ? { balance_link_ref: link_ref } : {}),
    } as any)
  }

  /** Record that the balance landed. Idempotent, for the same reason. */
  async markBalancePaid(id: string, ref?: string | null) {
    const schedule: any = await this.retrievePaymentSchedule(id)
    if (schedule.balance_status === "paid") {
      return schedule
    }
    return await this.updatePaymentSchedules({
      id,
      balance_status: "paid",
      balance_paid_at: new Date(),
      ...(ref ? { balance_link_ref: ref } : {}),
    } as any)
  }

  /** Attach the order once the cart completes. */
  async attachOrder(id: string, order_id: string) {
    return await this.updatePaymentSchedules({ id, order_id } as any)
  }
}

export default PaymentScheduleService
