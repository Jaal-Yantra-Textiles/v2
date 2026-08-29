import {
  assessInventoryOrderClaims,
  foldInventoryOrderClaims,
  foldRunClaims,
  inventoryOrderHeadroom,
  inventoryOrdersAlreadyClaimedMessage,
  listPartnerRunClaims,
  runsAlreadyClaimedMessage,
} from "../run-claims"

/**
 * The defect these cover: every "is this run already paid for" guard fetched
 * priors with `{ design_id: [...] }`, so a claim held by a line with
 * `design_id: null` was invisible and the run could be billed twice.
 *
 * The load-bearing case is `finds a claim held by a line with no design_id`.
 * Against the old design-scoped query that case CANNOT pass — the prior is
 * simply not in the result set.
 */
describe("foldRunClaims", () => {
  it("finds a claim held by a line with no design_id", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_run_sourced",
        submission_status: "Paid",
        production_run_ids: ["run_a", "run_b"],
      },
    ])

    expect(claims.get("run_a")).toEqual({
      submission_id: "sub_run_sourced",
      submission_status: "Paid",
    })
    expect(claims.get("run_b")?.submission_id).toBe("sub_run_sourced")
  })

  it("ignores a Rejected submission — its lines release their runs", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_rejected",
        submission_status: "Rejected",
        production_run_ids: ["run_a"],
      },
    ])

    expect(claims.has("run_a")).toBe(false)
  })

  it("treats a Draft as a live claim on a named run", () => {
    // Unlike the runless guard, which exempts Draft so a partner can submit
    // the auto-draft they were handed. A run NAMED by a draft is different.
    const claims = foldRunClaims([
      {
        submission_id: "sub_draft",
        submission_status: "Draft",
        production_run_ids: ["run_a"],
      },
    ])

    expect(claims.get("run_a")?.submission_status).toBe("Draft")
  })

  it("keeps the earliest claim when two lines name the same run", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_first",
        submission_status: "Paid",
        production_run_ids: ["run_a"],
      },
      {
        submission_id: "sub_second",
        submission_status: "Pending",
        production_run_ids: ["run_a"],
      },
    ])

    expect(claims.get("run_a")?.submission_id).toBe("sub_first")
  })

  it("tolerates a line with no runs at all", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_task",
        submission_status: "Paid",
        production_run_ids: null,
      },
    ])

    expect(claims.size).toBe(0)
  })
})

describe("listPartnerRunClaims", () => {
  const service = (submissions: any[], items: any[]) => ({
    listPaymentSubmissions: jest.fn().mockResolvedValue(submissions),
    listPaymentSubmissionItems: jest.fn().mockResolvedValue(items),
  })

  it("sees a run-sourced claim that a design-scoped query would miss", async () => {
    const svc = service(
      [{ id: "sub_1" }],
      [
        {
          submission_id: "sub_1",
          submission: { id: "sub_1", status: "Paid" },
          design_id: null, // ← the whole point
          production_run_ids: ["run_order_79"],
        },
      ]
    )

    const claims = await listPartnerRunClaims(svc as any, "partner_1")

    expect(claims.has("run_order_79")).toBe(true)
    // Scoped by partner, so the submission lookup is the partner's, not a design's.
    expect(svc.listPaymentSubmissions).toHaveBeenCalledWith({
      partner_id: "partner_1",
    })
  })

  it("excludes the submission being edited, so a claim cannot conflict with itself", async () => {
    const svc = service(
      [{ id: "sub_self" }, { id: "sub_other" }],
      [
        {
          submission_id: "sub_other",
          submission: { id: "sub_other", status: "Pending" },
          production_run_ids: ["run_b"],
        },
      ]
    )

    await listPartnerRunClaims(svc as any, "partner_1", {
      excludeSubmissionId: "sub_self",
    })

    expect(svc.listPaymentSubmissionItems).toHaveBeenCalledWith(
      { submission_id: ["sub_other"] },
      { relations: ["submission"] }
    )
  })

  it("returns empty without querying items when the partner has no submissions", async () => {
    const svc = service([], [])

    const claims = await listPartnerRunClaims(svc as any, "partner_1")

    expect(claims.size).toBe(0)
    expect(svc.listPaymentSubmissionItems).not.toHaveBeenCalled()
  })

  it("returns empty for a missing partner id rather than querying every row", async () => {
    const svc = service([{ id: "sub_1" }], [])

    const claims = await listPartnerRunClaims(svc as any, "")

    expect(claims.size).toBe(0)
    expect(svc.listPaymentSubmissions).not.toHaveBeenCalled()
  })
})

describe("runsAlreadyClaimedMessage", () => {
  it("names the submission holding each run", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_1",
        submission_status: "Paid",
        production_run_ids: ["run_a"],
      },
    ])

    expect(runsAlreadyClaimedMessage(["run_a"], claims)).toBe(
      "Production runs already paid for: run_a (submission sub_1, Paid)"
    )
  })
})

/**
 * #1617 — an inventory order is claimed in TRANCHES, not whole.
 *
 * The defect: `foldInventoryOrderClaims` keyed on `inventory_order_id` alone,
 * so the FIRST live line claimed the whole order and every later line naming it
 * was refused. Recording ₹30,000 of an agreed ₹35,000 — the only honest thing
 * to record, being what left the bank — made the remaining ₹5,000 unbillable.
 */
describe("foldInventoryOrderClaims", () => {
  it("sums the tranches rather than letting the first line claim the order", () => {
    const claims = foldInventoryOrderClaims([
      {
        submission_id: "sub_first",
        submission_status: "Paid",
        production_run_ids: null,
        inventory_order_id: "inv_order_1",
        amount: 30000,
      },
      {
        submission_id: "sub_second",
        submission_status: "Approved",
        production_run_ids: null,
        inventory_order_id: "inv_order_1",
        amount: 3000,
      },
    ])

    expect(claims.get("inv_order_1")?.claimed_total).toBe(33000)
    // Both holders named, so a refusal can say who has the rest.
    expect(claims.get("inv_order_1")?.claims.map((c) => c.submission_id)).toEqual([
      "sub_first",
      "sub_second",
    ])
  })

  it("releases a Rejected line's claim", () => {
    const claims = foldInventoryOrderClaims([
      {
        submission_id: "sub_rejected",
        submission_status: "Rejected",
        production_run_ids: null,
        inventory_order_id: "inv_order_1",
        amount: 30000,
      },
    ])

    expect(claims.has("inv_order_1")).toBe(false)
  })

  /**
   * A line with no amount must contribute NOTHING rather than defaulting.
   * Inventing a figure here either fabricates headroom or consumes headroom
   * that exists — both are wrong, and both are silent.
   */
  it("counts a line with no amount as zero, not as the whole order", () => {
    const claims = foldInventoryOrderClaims([
      {
        submission_id: "sub_amountless",
        submission_status: "Approved",
        production_run_ids: null,
        inventory_order_id: "inv_order_1",
        amount: null,
      },
    ])

    expect(claims.get("inv_order_1")?.claimed_total).toBe(0)
    // Still recorded as a claim — the order is not unclaimed, it is claimed
    // for an amount nobody stated.
    expect(claims.get("inv_order_1")?.claims).toHaveLength(1)
  })
})

describe("inventoryOrderHeadroom", () => {
  it("is what remains against the ceiling", () => {
    const claims = foldInventoryOrderClaims([
      {
        submission_id: "sub_first",
        submission_status: "Paid",
        production_run_ids: null,
        inventory_order_id: "inv_order_1",
        amount: 30000,
      },
    ])

    // The real case: ₹35,000 agreed, ₹30,000 released, ₹5,000 outstanding.
    expect(inventoryOrderHeadroom(claims.get("inv_order_1"), 35000)).toBe(5000)
  })

  it("never goes negative when an order was overpaid", () => {
    const claims = foldInventoryOrderClaims([
      {
        submission_id: "sub_over",
        submission_status: "Paid",
        production_run_ids: null,
        inventory_order_id: "inv_order_1",
        amount: 40000,
      },
    ])

    expect(inventoryOrderHeadroom(claims.get("inv_order_1"), 35000)).toBe(0)
  })

  it("is the whole ceiling when nothing has been claimed", () => {
    expect(inventoryOrderHeadroom(undefined, 35000)).toBe(35000)
  })
})

describe("inventoryOrdersAlreadyClaimedMessage", () => {
  /**
   * The old message said only "already paid for", which told the caller to give
   * up. What they need is how much is still billable and who holds the rest.
   */
  it("names the headroom and the prior holders", () => {
    const claims = foldInventoryOrderClaims([
      {
        submission_id: "sub_first",
        submission_status: "Paid",
        production_run_ids: null,
        inventory_order_id: "inv_order_1",
        amount: 30000,
      },
    ])

    const message = inventoryOrdersAlreadyClaimedMessage(
      [
        {
          order_id: "inv_order_1",
          ceiling: 35000,
          claimed_total: 30000,
          requested: 10000,
        },
      ],
      claims
    )

    expect(message).toContain("inv_order_1")
    expect(message).toContain("worth 35000")
    expect(message).toContain("already claimed 30000")
    expect(message).toContain("5000 remaining")
    expect(message).toContain("asks for 10000")
    expect(message).toContain("sub_first")
  })
})

/**
 * The money decision itself. Inventory-order-sourced payouts have NO
 * integration coverage, so these are the only tests that exercise the ceiling.
 */
describe("assessInventoryOrderClaims", () => {
  const claimsOf = (amount: number, status = "Paid") =>
    foldInventoryOrderClaims([
      {
        submission_id: "sub_first",
        submission_status: status,
        production_run_ids: null,
        inventory_order_id: "inv_order_1",
        amount,
      },
    ])

  /**
   * 🔴 The case that opened #1617: a part payment must not lock out the
   * balance. Against the old whole-order guard this CANNOT pass — the order
   * appeared on a live submission, so the second line was refused outright.
   */
  it("allows the balance after a part payment", () => {
    expect(
      assessInventoryOrderClaims({
        requestedByOrder: new Map([["inv_order_1", 5000]]),
        orders: new Map([["inv_order_1", { total_price: 35000 }]]),
        claims: claimsOf(30000),
      })
    ).toEqual([])
  })

  it("refuses the excess over what the order is worth", () => {
    const result = assessInventoryOrderClaims({
      requestedByOrder: new Map([["inv_order_1", 10000]]),
      orders: new Map([["inv_order_1", { total_price: 35000 }]]),
      claims: claimsOf(30000),
    })

    expect(result).toEqual([
      {
        order_id: "inv_order_1",
        ceiling: 35000,
        claimed_total: 30000,
        requested: 10000,
      },
    ])
  })

  /**
   * The receipts value is NOT the ceiling. A line sent without an explicit
   * amount defaults to the receipts total, which on the order that opened this
   * derives ₹64,274 — above the ₹63,375.75 ordered total, so it is refused
   * rather than quietly overpaying.
   */
  it("refuses an amountless line that defaults to the receipts value", () => {
    const result = assessInventoryOrderClaims({
      requestedByOrder: new Map([["inv_order_1", 64274]]),
      orders: new Map([["inv_order_1", { total_price: 63375.75 }]]),
      claims: new Map(),
    })

    expect(result).toHaveLength(1)
    expect(result[0].ceiling).toBe(63375.75)
  })

  /**
   * `bigNumber` columns arrive as STRINGS through a raw service read. A guard
   * that compared strings would evaluate `"30000" + 5000 > "35000"` as string
   * concatenation and let anything through.
   */
  it("coerces string amounts from bigNumber columns", () => {
    const result = assessInventoryOrderClaims({
      requestedByOrder: new Map([["inv_order_1", 10000]]),
      orders: new Map([["inv_order_1", { total_price: "35000" }]]),
      claims: claimsOf(30000),
    })

    expect(result).toHaveLength(1)
    expect(result[0].ceiling).toBe(35000)
  })

  it("lets a Rejected prior release its claim", () => {
    expect(
      assessInventoryOrderClaims({
        requestedByOrder: new Map([["inv_order_1", 35000]]),
        orders: new Map([["inv_order_1", { total_price: 35000 }]]),
        claims: claimsOf(30000, "Rejected"),
      })
    ).toEqual([])
  })

  // An unpriced order is not blocked: the whole-order guard did not block those
  // either, and refusing here would make them unpayable rather than guarded.
  it("does not refuse when the order has no readable value", () => {
    expect(
      assessInventoryOrderClaims({
        requestedByOrder: new Map([["inv_order_1", 5000]]),
        orders: new Map([["inv_order_1", { total_price: 0 }]]),
        claims: new Map(),
      })
    ).toEqual([])
  })

  it("tolerates rounding on an exact final tranche", () => {
    expect(
      assessInventoryOrderClaims({
        requestedByOrder: new Map([["inv_order_1", 5000.001]]),
        orders: new Map([["inv_order_1", { total_price: 35000 }]]),
        claims: claimsOf(30000),
      })
    ).toEqual([])
  })
})
