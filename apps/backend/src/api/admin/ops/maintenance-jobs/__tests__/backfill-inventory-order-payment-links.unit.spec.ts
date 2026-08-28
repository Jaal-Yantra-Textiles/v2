import { backfillInventoryOrderPaymentLinksJob } from "../backfill-inventory-order-payment-links-job"

/**
 * #1622 — the edge from a payment to the inventory order it paid for, for the
 * payouts approved before #1621 wired it into approval.
 *
 * Driven against a fake container so the WRITE SHAPE is asserted, not just the
 * decision to write. `link.create` is not idempotent, so "would it write twice"
 * is the question that matters most here.
 */

const ORDER_A = "inv_order_a"
const ORDER_B = "inv_order_b"
const PAYMENT = "pay_1"

type Item = Record<string, any>

const makeContainer = (opts: {
  items: Item[]
  /** submission id → payment ids the submission↔payment link holds. */
  payments?: Record<string, string[]>
  /** inventory order id → payment ids ALREADY linked to it. */
  linked?: Record<string, string[]>
}) => {
  const linkCreate = jest.fn().mockResolvedValue(undefined)

  const query = {
    graph: jest.fn(async ({ entity, filters }: any) => {
      if (entity === "payment_submission") {
        const ids = opts.payments?.[filters.id] ?? []
        return { data: [{ id: filters.id, payments: ids.map((id) => ({ id })) }] }
      }
      if (entity === "inventory_orders") {
        const ids = opts.linked?.[filters.id] ?? []
        return {
          data: [
            { id: filters.id, internal_payments: ids.map((id) => ({ id })) },
          ],
        }
      }
      return { data: [] }
    }),
  }

  const container = {
    resolve: (key: string) => {
      if (key === "query") return query
      if (key === "link" || key === "remoteLink") return { create: linkCreate }
      return {
        listPaymentSubmissionItems: jest.fn().mockResolvedValue(opts.items),
      }
    },
  } as any

  return { container, linkCreate }
}

const line = (over: Item = {}): Item => ({
  id: "line_1",
  inventory_order_id: ORDER_A,
  submission: { id: "sub_1", status: "Paid", partner_id: "partner_1" },
  ...over,
})

describe("backfill-inventory-order-payment-links", () => {
  it("links a payment to the order its own line names", async () => {
    const { container, linkCreate } = makeContainer({
      items: [line()],
      payments: { sub_1: [PAYMENT] },
    })

    const result = await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.changes).toHaveLength(1)
    expect(linkCreate).toHaveBeenCalledTimes(1)
    expect(linkCreate.mock.calls[0][0]).toEqual([
      {
        inventory_orders: { inventory_orders_id: ORDER_A },
        internal_payments: { internal_payments_id: PAYMENT },
      },
    ])
  })

  it("writes nothing on a dry run", async () => {
    const { container, linkCreate } = makeContainer({
      items: [line()],
      payments: { sub_1: [PAYMENT] },
    })

    const result = await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: true,
      params: {},
    } as any)

    expect(result.changes).toHaveLength(1)
    expect(result.applied).toBe(false)
    expect(linkCreate).not.toHaveBeenCalled()
  })

  it("does NOT redraw an edge that already exists", async () => {
    // 🔴 link.create is not idempotent — a second call is a duplicate row.
    const { container, linkCreate } = makeContainer({
      items: [line()],
      payments: { sub_1: [PAYMENT] },
      linked: { [ORDER_A]: [PAYMENT] },
    })

    const result = await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.changes).toHaveLength(0)
    expect(linkCreate).not.toHaveBeenCalled()
    expect(result.summary).toContain("1 edge(s) already exist")
  })

  it("writes one edge when two lines name the SAME order in one pass", async () => {
    // The in-memory view must be updated as it writes, or the second line
    // re-reads a stale "not linked" and duplicates the row.
    const { container, linkCreate } = makeContainer({
      items: [line(), line({ id: "line_2" })],
      payments: { sub_1: [PAYMENT] },
    })

    await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(linkCreate).toHaveBeenCalledTimes(1)
  })

  it("links the payment to EVERY order a multi-source payout names", async () => {
    // hrhandloom's real payout: two inventory orders, one submission. Linking
    // only the first makes the second invisible from its own page again.
    const { container, linkCreate } = makeContainer({
      items: [line(), line({ id: "line_2", inventory_order_id: ORDER_B })],
      payments: { sub_1: [PAYMENT] },
    })

    const result = await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.changes.map((c) => c.id).sort()).toEqual([
      `${ORDER_A}:${PAYMENT}`,
      `${ORDER_B}:${PAYMENT}`,
    ])
    expect(linkCreate).toHaveBeenCalledTimes(2)
  })

  it("SKIPS a payout with no payment record, and says so", async () => {
    // A Pending payout naming an order is a real state. The edge is
    // payment→order and there is no payment; silence would read as "linked".
    const { container, linkCreate } = makeContainer({
      items: [line({ submission: { id: "sub_1", status: "Pending" } })],
      payments: { sub_1: [] },
    })

    const result = await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.changes).toHaveLength(0)
    expect(linkCreate).not.toHaveBeenCalled()
    expect(result.summary).toContain("no payment record yet")
    expect(result.summary).toContain("sub_1 (Pending)")
  })

  it("ignores lines that name no inventory order", async () => {
    const { container, linkCreate } = makeContainer({
      items: [line({ inventory_order_id: null, design_id: "design_1" })],
      payments: { sub_1: [PAYMENT] },
    })

    const result = await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.changes).toHaveLength(0)
    expect(linkCreate).not.toHaveBeenCalled()
    expect(result.summary).toContain("No inventory order is missing its payment link")
  })

  it("stops at the limit", async () => {
    const { container, linkCreate } = makeContainer({
      items: [line(), line({ id: "line_2", inventory_order_id: ORDER_B })],
      payments: { sub_1: [PAYMENT] },
    })

    await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: false,
      params: { limit: 1 },
    } as any)

    expect(linkCreate).toHaveBeenCalledTimes(1)
  })

  it("does not let one failure strand the rest of the pass", async () => {
    const { container, linkCreate } = makeContainer({
      items: [line(), line({ id: "line_2", inventory_order_id: ORDER_B })],
      payments: { sub_1: [PAYMENT] },
    })
    linkCreate.mockRejectedValueOnce(new Error("link exploded"))

    const result = await backfillInventoryOrderPaymentLinksJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]?.message).toBe("link exploded")
    // The second order still got its edge.
    expect(linkCreate).toHaveBeenCalledTimes(2)
  })
})
