import {
  cartSkipReason,
  computeCartCutoff,
  purgeAbandonedCartsJob,
} from "../purge-abandoned-carts-job"
import {
  deleteOrphanWorkOrderMirrorsJob,
  readMirrorLegacyId,
  skipReason,
} from "../delete-orphan-work-order-mirrors-job"

/**
 * The two jobs that let anything be cleaned up at all.
 *
 * Neither a cart nor an orphaned work-order mirror could be removed from this
 * platform before these: no admin route, no MCP tool, no job. That was found
 * the ordinary way — verifying a storefront fix against production left four
 * guest carts behind with no way to clear them, and the same sweep turned up
 * order #107, a ₹14,000 inventory purchase order listing as a RETAIL sale
 * because the inventory order it mirrors had been deleted.
 *
 * What is tested here is the SELECTION, because on a job that deletes rows the
 * selection is the whole product. Both jobs are soft-delete only.
 */

const NOW = new Date("2026-09-16T00:00:00.000Z")

describe("purge-abandoned-carts — what it refuses", () => {
  const cutoff = computeCartCutoff(NOW, 30)
  const base = { cutoff, includeIdentified: false, emptyOnly: false }

  const cart = (over: Record<string, unknown> = {}) => ({
    id: "cart_1",
    created_at: "2026-01-01T00:00:00.000Z",
    email: null,
    customer_id: null,
    completed_at: null,
    items: [],
    ...over,
  })

  it("purges an old, never-completed, unidentified cart", () => {
    expect(cartSkipReason(cart(), base)).toBeNull()
  })

  /**
   * 🔴 The refusal with no override.
   *
   * A completed cart became an order and the order still points at it. There is
   * deliberately no flag to force this — a parameter that exists gets passed.
   */
  it("🔴 REFUSES a completed cart, at any age", () => {
    const old = cart({
      completed_at: "2026-01-02T00:00:00.000Z",
      created_at: "2020-01-01T00:00:00.000Z",
    })
    expect(cartSkipReason(old, base)).toMatch(/paper trail/)
    // …and with every widening flag turned on at once.
    expect(
      cartSkipReason(old, { cutoff, includeIdentified: true, emptyOnly: false })
    ).toMatch(/paper trail/)
  })

  it("refuses a cart newer than the cut-off", () => {
    expect(cartSkipReason(cart({ created_at: "2026-09-15T00:00:00.000Z" }), base))
      .toMatch(/newer than the cut-off/)
  })

  /**
   * A cart carrying an email is what cart-recovery mail is aimed at, so
   * widening to it is a marketing decision, not housekeeping.
   */
  it("refuses an identified cart unless asked", () => {
    const identified = cart({ email: "someone@example.com" })
    expect(cartSkipReason(identified, base)).toMatch(/recovery target/)
    expect(
      cartSkipReason(identified, { ...base, includeIdentified: true })
    ).toBeNull()
  })

  it("honours empty_only", () => {
    const withItems = cart({ items: [{ id: "li_1" }] })
    expect(cartSkipReason(withItems, base)).toBeNull()
    expect(cartSkipReason(withItems, { ...base, emptyOnly: true })).toMatch(
      /1 line item/
    )
  })

  it("refuses a cart whose age cannot be established", () => {
    expect(cartSkipReason(cart({ created_at: null }), base)).toMatch(
      /cannot establish its age/
    )
    expect(cartSkipReason(cart({ created_at: "not-a-date" }), base)).toMatch(
      /cannot establish its age/
    )
  })

  it("requires an explicit age — there is no default", async () => {
    await expect(
      purgeAbandonedCartsJob.run({} as any, { dry_run: true, params: {} })
    ).rejects.toThrow()
  })
})

describe("purge-abandoned-carts — dry run writes nothing", () => {
  const container = (carts: any[]) => {
    const calls: string[][] = []
    return {
      calls,
      resolve: () => ({
        listCarts: async () => carts,
        softDeleteCarts: async (ids: string[]) => {
          calls.push(ids)
        },
      }),
    }
  }

  const old = {
    id: "cart_old",
    created_at: "2026-01-01T00:00:00.000Z",
    email: null,
    customer_id: null,
    completed_at: null,
    items: [],
  }

  it("🔴 previews the delete without performing it", async () => {
    const c = container([old])
    const res = await purgeAbandonedCartsJob.run(c as any, {
      dry_run: true,
      params: { older_than_days: 30 },
    })
    expect(res.applied).toBe(false)
    expect(res.changes.map((x) => x.id)).toEqual(["cart_old"])
    // Asserted on the SPY, not on the absence of a throw: a delete that quietly
    // ran during a preview would otherwise look exactly like one that did not.
    expect(c.calls).toEqual([])
  })

  it("performs it when applied", async () => {
    const c = container([old])
    const res = await purgeAbandonedCartsJob.run(c as any, {
      dry_run: false,
      params: { older_than_days: 30 },
    })
    expect(res.applied).toBe(true)
    expect(c.calls).toEqual([["cart_old"]])
  })

  it("does not call the delete at all when nothing matched", async () => {
    const c = container([{ ...old, completed_at: "2026-02-01T00:00:00.000Z" }])
    const res = await purgeAbandonedCartsJob.run(c as any, {
      dry_run: false,
      params: { older_than_days: 30 },
    })
    expect(res.applied).toBe(false)
    expect(c.calls).toEqual([])
  })
})

describe("delete-orphan-work-order-mirrors — selection", () => {
  it("reads the legacy id only for its own kind", () => {
    const inv = { metadata: { legacy_id: "inv_order_1" } }
    const run = { metadata: { legacy_id: "prod_run_1" } }
    expect(readMirrorLegacyId(inv, "inventory")).toBe("inv_order_1")
    expect(readMirrorLegacyId(inv, "design")).toBeNull()
    expect(readMirrorLegacyId(run, "design")).toBe("prod_run_1")
  })

  it("treats a genuine retail order as no mirror at all", () => {
    expect(readMirrorLegacyId({ metadata: {} }, "inventory")).toBeNull()
    expect(readMirrorLegacyId({ metadata: null }, "inventory")).toBeNull()
    expect(
      readMirrorLegacyId({ metadata: { legacy_id: 42 } } as any, "inventory")
    ).toBeNull()
  })

  /**
   * 🔴 The one that matters: a mirror whose execution row is STILL THERE is a
   * live work order. #108 — a real Shiprocket shipment in transit — is that
   * row, seven minutes younger than #107 and otherwise identical.
   */
  it("🔴 REFUSES a mirror whose execution row still exists", () => {
    expect(skipReason({ status: "pending" }, true, false)).toMatch(
      /still exists/
    )
    // Not even with include_settled, which widens a different axis entirely.
    expect(skipReason({ status: "pending" }, true, true)).toMatch(/still exists/)
  })

  it("retires the orphan — #107's exact shape", () => {
    expect(
      skipReason({ status: "canceled", summary: { paid_total: 0 } }, false, false)
    ).toBeNull()
  })

  it("refuses a completed or paid mirror unless asked", () => {
    expect(skipReason({ status: "completed" }, false, false)).toMatch(
      /completed/
    )
    expect(
      skipReason({ status: "pending", summary: { paid_total: 500 } }, false, false)
    ).toMatch(/records money that moved/)

    expect(skipReason({ status: "completed" }, false, true)).toBeNull()
    expect(
      skipReason({ status: "pending", summary: { paid_total: 500 } }, false, true)
    ).toBeNull()
  })

  /**
   * ⚠️ `paid_total: 0` must read as "nothing captured", not as a missing value.
   * `Number(null)` is 0 and 0 is not null — the guard has to survive both.
   */
  it("treats an absent paid_total as nothing captured", () => {
    expect(skipReason({ status: "pending" }, false, false)).toBeNull()
    expect(
      skipReason({ status: "pending", summary: null }, false, false)
    ).toBeNull()
    expect(
      skipReason({ status: "pending", summary: { paid_total: 0 } }, false, false)
    ).toBeNull()
  })
})

describe("both jobs are registered", () => {
  it("exposes an id, a label and a described param set", () => {
    for (const job of [purgeAbandonedCartsJob, deleteOrphanWorkOrderMirrorsJob]) {
      expect(job.id).toBeTruthy()
      expect(job.label).toBeTruthy()
      expect(job.description.length).toBeGreaterThan(80)
      for (const p of job.params) {
        expect(p.description).toBeTruthy()
      }
    }
  })
})
