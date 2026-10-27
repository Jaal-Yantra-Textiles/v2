import { planCartCollection, assertCollectable, manualDepositAmount } from "../deposit-collection"

/**
 * #1451 — the quote page promised a 30% deposit and the rail charged 100%.
 *
 * The three prod schedules that existed when this was written are the fixtures:
 * €4,766.51 / €1,429.95, ₹90,099 / ₹27,029.70, €4,753.01 / €1,425.90 — all
 * `deposit_status: pending`, all with a cart and no order, because nobody had
 * completed a checkout yet. The first buyer who did would have been charged the
 * whole total.
 *
 * These cases are about MONEY, so each asserts the amount, not just a branch.
 */
const schedule = (over: Record<string, unknown> = {}) => ({
  id: "01M0QGQZPDXW85KZZ7G50FD2RG",
  deposit_amount: "1429.95",
  total_due: "4766.51",
  deposit_status: "pending",
  currency_code: "eur",
  ...over,
})

describe("planCartCollection", () => {
  it("collects the DEPOSIT, not the total — the whole defect (#1451)", () => {
    const plan = planCartCollection({
      cartTotal: 4766.51,
      cartCurrency: "eur",
      schedule: schedule(),
    })

    expect(plan.basis).toBe("deposit")
    // 🔴 The number. 4766.51 here is the bug shipping.
    expect(plan.amount).toBe(1429.95)
    expect(plan.reason).toContain("3336.56")
  })

  it("charges an ordinary cart in full — every non-quote cart takes this path", () => {
    const plan = planCartCollection({ cartTotal: 250, cartCurrency: "eur", schedule: null })

    expect(plan.basis).toBe("full")
    expect(plan.amount).toBe(250)
    expect(plan.schedule_id).toBeNull()
  })

  it("treats a 100% deposit as payable in full rather than a mismatch", () => {
    // deposit_pct: 100 is a legitimate schedule, not a broken one.
    const plan = planCartCollection({
      cartTotal: 4766.51,
      cartCurrency: "eur",
      schedule: schedule({ deposit_amount: "4766.51" }),
    })

    expect(plan.basis).toBe("deposit")
    expect(plan.amount).toBe(4766.51)
  })

  describe("refusals — every one returns null, never a fallback amount", () => {
    /**
     * 🔑 Falling back to the cart total in any of these IS the bug, written on
     * purpose. So each case asserts `amount` is null, not merely that a flag
     * was set.
     */
    it("refuses a deposit that is already paid, rather than charging again", () => {
      const plan = planCartCollection({
        cartTotal: 4766.51,
        cartCurrency: "eur",
        schedule: schedule({ deposit_status: "paid" }),
      })

      expect(plan.basis).toBe("refuse")
      expect(plan.amount).toBeNull()
      expect(plan.reason).toMatch(/twice/i)
    })

    it("refuses a waived deposit — the balance is not collected on this cart", () => {
      const plan = planCartCollection({
        cartTotal: 4766.51,
        schedule: schedule({ deposit_status: "waived" }),
      })
      expect(plan.basis).toBe("refuse")
      expect(plan.amount).toBeNull()
    })

    it("refuses a stored 0 deposit, which would let the buyer pay nothing", () => {
      const plan = planCartCollection({
        cartTotal: 4766.51,
        schedule: schedule({ deposit_amount: 0 }),
      })
      expect(plan.basis).toBe("refuse")
      expect(plan.amount).toBeNull()
    })

    it("refuses a null deposit — Number(null) is 0, and one test must catch both", () => {
      const plan = planCartCollection({
        cartTotal: 4766.51,
        schedule: schedule({ deposit_amount: null }),
      })
      expect(plan.basis).toBe("refuse")
      expect(plan.amount).toBeNull()
    })

    it("refuses a deposit larger than the cart", () => {
      const plan = planCartCollection({
        cartTotal: 1000,
        cartCurrency: "eur",
        schedule: schedule({ deposit_amount: "1429.95" }),
      })
      expect(plan.basis).toBe("refuse")
      expect(plan.amount).toBeNull()
    })

    it("🔴 refuses a currency mismatch — a rupee figure signed as euros", () => {
      // The ₹27,029.70 prod schedule against a EUR cart. Neither rail would
      // notice: the amount is a bare number the gateway signs.
      const plan = planCartCollection({
        cartTotal: 4766.51,
        cartCurrency: "eur",
        schedule: schedule({ deposit_amount: "27029.70", total_due: "90099", currency_code: "inr" }),
      })
      expect(plan.basis).toBe("refuse")
      expect(plan.reason).toMatch(/INR/)
      expect(plan.reason).toMatch(/EUR/)
    })

    it("refuses a cart with no usable total", () => {
      const plan = planCartCollection({ cartTotal: null, schedule: schedule() })
      expect(plan.basis).toBe("refuse")
      expect(plan.amount).toBeNull()
    })
  })

  describe("assertCollectable", () => {
    it("throws on a refusal, carrying the reason to the checkout", () => {
      const plan = planCartCollection({
        cartTotal: 4766.51,
        schedule: schedule({ deposit_status: "paid" }),
      })
      expect(() => assertCollectable(plan)).toThrow(/twice/i)
    })

    it("passes a deposit and a full charge through untouched", () => {
      expect(() =>
        assertCollectable(planCartCollection({ cartTotal: 250, schedule: null }))
      ).not.toThrow()
      expect(() =>
        assertCollectable(
          planCartCollection({ cartTotal: 4766.51, cartCurrency: "eur", schedule: schedule() })
        )
      ).not.toThrow()
    })
  })
})

/**
 * A MANUAL deposit (admin's % on a design order) follows the cart total at
 * checkout. Cherry, 2026-10-27: set at 10% while the cart was ₹8,000 pre-GST,
 * stored ₹800; the cart is ₹8,400 once 5% GST applies, so ₹840 is due.
 */
describe("planCartCollection — a manual deposit follows the live cart total", () => {
  const manual = {
    id: "sched_cherry",
    source_type: "manual",
    deposit_pct: 10,
    deposit_amount: 800,
    total_due: 8000,
    deposit_status: "pending",
    currency_code: "inr",
  }

  it("charges 10% of the cart AS IT IS NOW, not of the total when it was set", () => {
    const plan = planCartCollection({ cartTotal: 8400, cartCurrency: "inr", schedule: manual })
    expect(plan.basis).toBe("deposit")
    expect(plan.amount).toBe(840)
    expect(plan.reason).toContain("7560")
  })

  it("leaves a QUOTE deposit exactly as stored — it was priced with tax at mint", () => {
    const plan = planCartCollection({
      cartTotal: 8400,
      cartCurrency: "inr",
      schedule: { ...manual, source_type: "quote" },
    })
    expect(plan.amount).toBe(800)
  })

  it("rounds to the paisa", () => {
    expect(manualDepositAmount({ source_type: "manual", deposit_pct: 10 }, 293.69)).toBe(29.37)
  })

  it.each([
    [{ source_type: "quote", deposit_pct: 10 }, 8400],
    [{ source_type: "manual", deposit_pct: null }, 8400],
    [{ source_type: "manual", deposit_pct: 0 }, 8400],
    [{ source_type: "manual", deposit_pct: 10 }, null],
    [{ source_type: "manual", deposit_pct: 10 }, 0],
    [null, 8400],
  ])("has no live amount for %p at total %p — the stored figure and its refusals apply", (sched, total) => {
    expect(manualDepositAmount(sched as any, total)).toBeNull()
  })
})
