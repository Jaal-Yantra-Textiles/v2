import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import priceFxMetaLink from "../../../../../links/price-fx-meta"
import { FX_RATES_MODULE } from "../../../../../modules/fx_rates"
import {
  compactFxPriceMetaJob,
  isOrphanedFxMeta,
} from "../compact-fx-price-meta-job"

/**
 * #1857 — the FX marker compaction pass.
 *
 * The pure predicate is one line; what is worth locking down is the SHAPE of
 * the apply path, because every way of getting it wrong is silent:
 *
 *   - taking the price id from `meta.price.id` gets `undefined` on exactly the
 *     rows this job exists for, and a dismiss with a missing side removes
 *     nothing while the delete still succeeds — leaving a link row whose BOTH
 *     ends are gone, which is worse than the dangle being cleaned up
 *   - deleting before dismissing has the same end state if the dismiss throws
 *   - a dry run that writes anything is unarguable in the wrong direction
 */

describe("isOrphanedFxMeta", () => {
  it("is true when the price did not resolve", () => {
    expect(isOrphanedFxMeta({ price: null })).toBe(true)
    expect(isOrphanedFxMeta({})).toBe(true)
  })

  it("is true for a price object with no id", () => {
    // A soft-deleted target resolves to the same absent join as a hard-deleted
    // one. Asking "does a row exist" instead of "can the graph see it" is what
    // took the prod count from 27 pairs to 46.
    expect(isOrphanedFxMeta({ price: {} })).toBe(true)
  })

  it("is false for a live price", () => {
    expect(isOrphanedFxMeta({ price: { id: "price_1" } })).toBe(false)
  })
})

/** One live marker, one orphan — the orphan's price id exists ONLY on the link row. */
const buildContainer = () => {
  const graph = jest.fn(async ({ entity }: { entity: string }) => {
    if (entity === "fx_price_meta") {
      return {
        data: [
          { id: "meta_live", base_currency: "inr", base_amount: 10, fx_rate: 1, price: { id: "price_live" } },
          { id: "meta_orphan", base_currency: "inr", base_amount: 10, fx_rate: 1, price: null },
        ],
      }
    }
    if (entity === priceFxMetaLink.entryPoint) {
      return {
        data: [{ fx_price_meta_id: "meta_orphan", price_id: "price_dead" }],
      }
    }
    return { data: [] }
  })

  const order: string[] = []
  /*
   * 🔴 The parameters are DECLARED even though the bodies ignore them.
   * `jest.fn(async () => …)` types `mock.calls` as an empty tuple, so
   * `mock.calls[0][0]` below is `error TS2493` — and jest itself is perfectly
   * happy, so the suite goes green and `check:prod-build` (which compiles the
   * specs) is the thing that fails.
   */
  const dismiss = jest.fn(async (_defs: Record<string, any>[]) => {
    order.push("dismiss")
  })
  const deleteFxPriceMetas = jest.fn(async (_id: string) => {
    order.push("delete")
  })

  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === ContainerRegistrationKeys.LINK) return { dismiss }
      if (key === FX_RATES_MODULE) return { deleteFxPriceMetas }
      return {}
    },
  }

  return { container, graph, dismiss, deleteFxPriceMetas, order }
}

describe("compact-fx-price-meta — dry run", () => {
  it("selects only the orphan and states why", async () => {
    const { container, dismiss, deleteFxPriceMetas } = buildContainer()

    const result = await compactFxPriceMetaJob.run(container, {
      dry_run: true,
      params: {},
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].id).toBe("meta_orphan")
    expect(result.applied).toBe(false)
    // 🔴 The reason field is `note`. Named `reason` it type-errors only without
    // a cast — and with one, the dry run silently loses the only thing that
    // makes it checkable.
    expect(result.changes[0].note).toContain("price_dead")
    expect(result.summary).toContain("Would prune 1")

    // Asserted on the mocks AFTER the call, never inside them.
    expect(dismiss).not.toHaveBeenCalled()
    expect(deleteFxPriceMetas).not.toHaveBeenCalled()
  })
})

describe("compact-fx-price-meta — apply", () => {
  it("dismisses with the price id FROM THE LINK ROW, then deletes", async () => {
    const { container, dismiss, deleteFxPriceMetas, order } = buildContainer()

    const result = await compactFxPriceMetaJob.run(container, {
      dry_run: false,
      params: {},
    })

    expect(result.applied).toBe(true)

    /*
     * 🔴 `price_dead` comes only from the link table. `meta.price` is null on
     * this row — that is what makes it an orphan — so a dismiss built from the
     * meta would carry `price_id: undefined` and quietly match nothing.
     */
    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(dismiss.mock.calls[0][0]).toEqual([
      {
        [Modules.PRICING]: { price_id: "price_dead" },
        [FX_RATES_MODULE]: { fx_price_meta_id: "meta_orphan" },
      },
    ])

    expect(deleteFxPriceMetas).toHaveBeenCalledTimes(1)
    expect(deleteFxPriceMetas.mock.calls[0][0]).toBe("meta_orphan")

    // Order matters: reversed, a throw between them strands the link row.
    expect(order).toEqual(["dismiss", "delete"])
  })

  it("leaves the live marker completely alone", async () => {
    const { container, dismiss, deleteFxPriceMetas } = buildContainer()
    await compactFxPriceMetaJob.run(container, { dry_run: false, params: {} })

    const touched = [
      ...dismiss.mock.calls.flat(),
      ...deleteFxPriceMetas.mock.calls,
    ]
    expect(JSON.stringify(touched)).not.toContain("meta_live")
    expect(JSON.stringify(touched)).not.toContain("price_live")
  })
})
