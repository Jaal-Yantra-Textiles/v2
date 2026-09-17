/**
 * #891, the 2026-09-13 founder call: **the stock movement fires on admin
 * approval.**
 *
 * Partner completion is a *claim*; admin approval is the *acceptance* of that
 * claim. Stock must not exist in our books on an unaccepted claim — so a goods
 * transfer may be received, counted and recorded, and still move nothing until
 * the run behind it is approved.
 *
 * Before this, `receiveGoodsTransfer` never looked at `approval_decision` at
 * all: a transfer on a run nobody had approved moved stock into our locations
 * exactly as if it had been.
 *
 * The two halves that must agree:
 *   approved → then received   the receipt posts, inline
 *   received → then approved   `postPendingTransfersForRun` posts it
 *
 * and the thing that makes the second possible is `inventory_posted_at` being
 * distinct from `received_at`.
 */

import {
  acceptedQuantity,
  isPendingPosting,
  planTransferMove,
  INVENTORY_POSTING_COLUMN_RELEASED_AT,
} from "../receive-goods-transfer"

const FROM = "sloc_partner"
const TO = "sloc_house"

const transfer = (over: Record<string, any> = {}) => ({
  quantity: 2,
  from_location_id: FROM,
  to_location_id: TO,
  ...over,
})

const approved = { approval_decision: "approved", produced_quantity: 2, rejected_quantity: 0 }

describe("the approval gate on a goods transfer's posting", () => {
  it("moves stock for an APPROVED run", () => {
    const plan = planTransferMove(transfer(), 2, approved)
    expect(plan).toMatchObject({ move: true, quantity: 2, from_location_id: FROM, to_location_id: TO })
    expect(plan.skip_reason).toBeUndefined()
  })

  /**
   * 🔴 The defect this closes. The receipt is still real — the box arrived and
   * refusing to record that would lose a physical fact to an accounting rule —
   * but nothing moves.
   */
  it.each([
    ["undecided", null],
    ["explicitly rejected", "rejected"],
    ["some other value", "pending"],
  ])("moves NOTHING for a run that is %s", (_label, decision) => {
    const plan = planTransferMove(transfer(), 2, {
      approval_decision: decision,
      produced_quantity: 2,
    })
    expect(plan.move).toBe(false)
    expect(plan.skip_reason).toBe("unapproved_run")
  })

  /**
   * The gate is checked BEFORE the quantity test, so an unapproved run says so
   * rather than hiding behind a zero it happens to have been capped to.
   */
  it("reports unapproved_run rather than zero_quantity when both would apply", () => {
    const plan = planTransferMove(transfer(), 0, {
      approval_decision: null,
      produced_quantity: 0,
    })
    expect(plan.skip_reason).toBe("unapproved_run")
  })

  /**
   * A caller that does not know the run — and the historical backfill — must
   * keep the old behaviour. Declining to move real goods because an argument
   * was omitted would be a silent regression.
   */
  it("does not treat an absent run as unapproved", () => {
    expect(planTransferMove(transfer(), 2).move).toBe(true)
    expect(planTransferMove(transfer(), 2, null).move).toBe(true)
  })

  it("still refuses the three movements that were always wrong", () => {
    expect(planTransferMove(transfer({ to_location_id: null }), 1, approved).skip_reason).toBe("customer_leg")
    expect(planTransferMove(transfer({ to_location_id: FROM }), 1, approved).skip_reason).toBe("same_location")
    expect(planTransferMove(transfer(), 0, approved).skip_reason).toBe("zero_quantity")
  })
})

describe("acceptedQuantity — post only what the approval accepted", () => {
  it("is produced minus rejected", () => {
    expect(acceptedQuantity({ produced_quantity: 3, rejected_quantity: 1 })).toBe(2)
    expect(acceptedQuantity({ produced_quantity: 3 })).toBe(3)
  })

  it("floors at 0 — a negative acceptance would post a movement backwards", () => {
    expect(acceptedQuantity({ produced_quantity: 1, rejected_quantity: 5 })).toBe(0)
  })

  /**
   * 🔴 null is UNSTATED, not zero. Capping a real receipt at 0 because a column
   * was never filled in would strand goods that are physically at the
   * destination — and `0` defeating a null check is its own family of bug here.
   */
  it("says null when the run states no produced quantity", () => {
    expect(acceptedQuantity({})).toBeNull()
    expect(acceptedQuantity({ produced_quantity: null })).toBeNull()
    // And 0 produced is a real, different answer from unstated.
    expect(acceptedQuantity({ produced_quantity: 0 })).toBe(0)
  })
})

describe("the accepted quantity caps what is posted", () => {
  /**
   * 🔴 A run that made 3 and had 1 rejected accepted 2. Posting all 3 puts a
   * rejected garment in our books at our location while it is physically still
   * the partner's problem — a wrong SPLIT, the family that once minted a
   * phantom jacket and put it on sale at ₹11,000.
   */
  it("posts only the accepted units when some were rejected", () => {
    const plan = planTransferMove(transfer({ quantity: 3 }), 3, {
      approval_decision: "approved",
      produced_quantity: 3,
      rejected_quantity: 1,
    })
    expect(plan.move).toBe(true)
    expect(plan.quantity).toBe(2)
    expect(plan.accepted_quantity).toBe(2)
  })

  /**
   * The cap is a MINIMUM against what was counted, never a replacement for it.
   * Goods that did not turn up are not posted because the paperwork accepted
   * them.
   */
  it("never posts more than actually arrived", () => {
    const plan = planTransferMove(transfer({ quantity: 5 }), 1, {
      approval_decision: "approved",
      produced_quantity: 5,
      rejected_quantity: 0,
    })
    expect(plan.quantity).toBe(1)
  })

  it("trusts the count when the run states no quantities", () => {
    const plan = planTransferMove(transfer(), 2, { approval_decision: "approved" })
    expect(plan.quantity).toBe(2)
    expect(plan.accepted_quantity).toBeNull()
  })

  it("refuses to move when everything produced was rejected", () => {
    const plan = planTransferMove(transfer(), 2, {
      approval_decision: "approved",
      produced_quantity: 2,
      rejected_quantity: 2,
    })
    expect(plan.move).toBe(false)
    expect(plan.skip_reason).toBe("zero_quantity")
  })
})

describe("isPendingPosting — which delivered transfers still owe a movement", () => {
  const CUTOFF = INVENTORY_POSTING_COLUMN_RELEASED_AT
  const after = new Date(CUTOFF.getTime() + 86_400_000)
  const before = new Date(CUTOFF.getTime() - 86_400_000)

  it("is pending when received after the column shipped and never posted", () => {
    expect(
      isPendingPosting({ status: "delivered", received_at: after, inventory_posted_at: null }, CUTOFF)
    ).toBe(true)
  })

  /**
   * 🔴🔴 THE TRAP. The same null means two opposite things depending on WHEN
   * the transfer was received:
   *
   *   received after the column shipped → null means NOT POSTED
   *   received before                   → null means UNRECORDED (already posted
   *                                        by the old unconditional path)
   *
   * Treating the second as pending moves the same goods a SECOND time.
   */
  it("is NOT pending for a legacy transfer whose null means 'unrecorded'", () => {
    expect(
      isPendingPosting({ status: "delivered", received_at: before, inventory_posted_at: null }, CUTOFF)
    ).toBe(false)
  })

  it("is not pending once it has been posted", () => {
    expect(
      isPendingPosting({ status: "delivered", received_at: after, inventory_posted_at: after }, CUTOFF)
    ).toBe(false)
  })

  it.each(["draft", "in_transit", "cancelled"])(
    "is not pending for a %s transfer — nothing arrived to post",
    (status) => {
      expect(
        isPendingPosting({ status, received_at: after, inventory_posted_at: null }, CUTOFF)
      ).toBe(false)
    }
  )

  it("is not pending without a received_at — it cannot be placed in time", () => {
    expect(
      isPendingPosting({ status: "delivered", received_at: null, inventory_posted_at: null }, CUTOFF)
    ).toBe(false)
  })

  it("accepts an ISO string as well as a Date (what the row actually holds)", () => {
    expect(
      isPendingPosting(
        { status: "delivered", received_at: after.toISOString(), inventory_posted_at: null },
        CUTOFF
      )
    ).toBe(true)
  })
})
