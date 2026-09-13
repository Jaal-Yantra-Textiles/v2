/**
 * #2029 item 3 — the production-run ↔ reservation link, proven against a real
 * database.
 *
 * 🔑 Why integration. `defineLink` registers as an import side effect, and a
 * `query.graph` hop that names the wrong entry point or the wrong column comes
 * back EMPTY rather than throwing. Empty is exactly what "this run holds no
 * reservations" looks like — so a unit test cannot tell a correct link from a
 * misspelt one, and the fallback would quietly cover for it forever.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/run-reservation-link
 */

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import productionRunReservationsLink from "../../src/links/production-run-reservations-link"
import {
  readLinkedReservationIds,
  selectRunReservations,
} from "../../src/workflows/production-runs/receive-goods-transfer"

jest.setTimeout(180_000)

/** More than any plausible default page size. */
const N = 60

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("production run ↔ reservation link (#2029 item 3)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    const seed = async () => {
      const container = getContainer()
      const inventory: any = container.resolve(Modules.INVENTORY)
      const stockLocation: any = container.resolve(Modules.STOCK_LOCATION)
      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`

      const loc = await stockLocation.createStockLocations({
        name: `RL Loc ${unique}`,
      })
      const item = await inventory.createInventoryItems({ sku: `RL-${unique}` })
      await inventory.createInventoryLevels({
        inventory_item_id: item.id,
        location_id: loc.id,
        stocked_quantity: 500,
      })
      return { container, inventory, loc, item, unique }
    }

    it("round-trips: a linked reservation is readable through the entry point", async () => {
      const { container, inventory, loc, item, unique } = await seed()
      const runService: any = container.resolve("production_runs")
      const run = await runService.createProductionRuns({
        status: "in_progress",
        quantity: 1,
        // Required column; contents irrelevant to the link.
        snapshot: {},
        captured_at: new Date(),
      })

      const reservation = await inventory.createReservationItems({
        inventory_item_id: item.id,
        location_id: loc.id,
        quantity: 1,
        line_item_id: `rl_li_${unique}`,
        // Deliberately NO metadata: only the link can identify this one, so an
        // empty read cannot be masked by the blob fallback.
        metadata: {},
      })

      const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
      await remoteLink.create({
        production_runs: { production_runs_id: run.id },
        [Modules.INVENTORY]: { reservation_item_id: reservation.id },
      })

      // Read through the REAL function the receipt path uses, not a hand-rolled
      // copy of its query — a typo in `readLinkedReservationIds` would return
      // empty and be silently covered by the blob fallback in production, and a
      // test that re-writes the query here would never see it.
      const linkedIds = await readLinkedReservationIds(container, run.id)

      // 🔴 The assertion that matters. A wrong entry point or column name gives
      // an empty set here, indistinguishable from "no reservations".
      expect([...linkedIds]).toEqual([reservation.id])

      // Sanity: the link's own entry point agrees with what that function read.
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: productionRunReservationsLink.entryPoint,
        filters: { production_runs_id: run.id },
        fields: ["reservation_item_id"],
      })
      expect(data.map((r: any) => r.reservation_item_id)).toEqual([reservation.id])

      // And the selector picks it although the blob says nothing.
      const listed = await inventory.listReservationItems({
        inventory_item_id: item.id,
        location_id: loc.id,
      })
      expect(selectRunReservations(listed, run.id, linkedIds).map((r: any) => r.id)).toEqual([
        reservation.id,
      ])
      // Blob-only would have found nothing — which is the bug the link removes.
      expect(selectRunReservations(listed, run.id)).toEqual([])
    })

    /**
     * `repointReservations` lists reservations by item + location and filters in
     * app. If the service ever applies a default page size, rows past it are
     * never seen and their reservations stay behind while the goods move.
     *
     * Measured, not assumed: today it returns everything. Kept as a guard so a
     * Medusa upgrade that introduces a default is caught here rather than by
     * stranded stock.
     */
    it(`lists all ${N} reservations at a location — no silent default page`, async () => {
      const { inventory, loc, item, unique } = await seed()
      for (let i = 0; i < N; i++) {
        await inventory.createReservationItems({
          inventory_item_id: item.id,
          location_id: loc.id,
          quantity: 1,
          line_item_id: `rl_page_${unique}_${i}`,
          metadata: { production_run_id: "prod_run_probe" },
        })
      }
      const listed = await inventory.listReservationItems({
        inventory_item_id: item.id,
        location_id: loc.id,
      })
      expect((listed || []).length).toBe(N)
      expect(selectRunReservations(listed, "prod_run_probe")).toHaveLength(N)
    })
  })
})
