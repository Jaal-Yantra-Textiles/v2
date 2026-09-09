import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  linkDesignsToOrderItems,
  repointOrderItemDesign,
} from "../../src/workflows/designs/link-designs-to-order-items"
import { resolveLineItemDesignId } from "../../src/lib/resolve-line-item-production"
import designOrderLineItemLink from "../../src/links/design-order-line-item-link"

jest.setTimeout(90 * 1000)

/**
 * #1919 — the design↔order-item binding as a real link.
 *
 * 🔴 This spec exists because a UNIT test cannot prove any of it.
 * `defineLink(...).entryPoint` is empty until the Medusa runtime loads links,
 * so a unit test's link query arrives with `entity: ""` and a stub keyed on
 * the name would answer nothing while appearing to pass. Only a booted
 * runtime can show the link is actually written and actually read back.
 */
setupSharedTestSuite(() => {
  describe("#1919 — design ↔ order line item link", () => {
    let adminHeaders: { headers: Record<string, string> }
    let regionId: string
    const { api, getContainer } = getSharedTestEnv()

    const makeDesign = async (name: string) => {
      const res = await api.post(
        "/admin/designs",
        {
          name,
          description: "Design for the item-link spec",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    /** A commissioning order: title-only items carrying metadata.design_id. */
    const makeDesignOrder = async (designIds: string[]) => {
      const container = getContainer()
      const { result: order }: any = await createOrderWorkflow(container).run({
        input: {
          is_draft_order: true,
          status: "draft",
          no_notification: true,
          region_id: regionId,
          currency_code: "inr",
          items: designIds.map((design_id, i) => ({
            title: `Item ${i}`,
            quantity: 1,
            unit_price: 100,
            metadata: { design_id },
          })) as any,
        } as any,
      })
      return order
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Item Link Region",
          currency_code: "inr",
          countries: ["in"],
        })
        regionId = region.id
      }
    })

    /**
     * The entryPoint is the load-bearing thing. If it is empty or wrong the
     * query returns EMPTY rather than erroring, so every other case in this
     * file could pass while reading nothing.
     */
    it("resolves a non-empty entryPoint once the runtime has loaded links", () => {
      expect((designOrderLineItemLink as any).entryPoint).toBeTruthy()
    })

    it("writes a link per item and reads it back through the entryPoint", async () => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const a = await makeDesign(`Link A ${Date.now()}`)
      const b = await makeDesign(`Link B ${Date.now()}`)
      const order = await makeDesignOrder([a, b])

      const res = await linkDesignsToOrderItems(container, order.id)
      expect(res.linked).toBe(2)
      expect(res.unresolved).toEqual([])

      const { data: rows } = await query.graph({
        entity: designOrderLineItemLink.entryPoint,
        fields: ["design_id", "order_line_item_id"],
        filters: { order_line_item_id: order.items.map((i: any) => i.id) },
      })
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((r: any) => r.design_id))).toEqual(new Set([a, b]))
    })

    it("is idempotent — a second run links nothing", async () => {
      const container = getContainer()
      const a = await makeDesign(`Idem ${Date.now()}`)
      const order = await makeDesignOrder([a])

      const first = await linkDesignsToOrderItems(container, order.id)
      expect(first.linked).toBe(1)

      const second = await linkDesignsToOrderItems(container, order.id)
      expect(second.linked).toBe(0)
      expect(second.skipped_existing).toBe(1)
    })

    it("dry run writes nothing", async () => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const a = await makeDesign(`Dry ${Date.now()}`)
      const order = await makeDesignOrder([a])

      const res = await linkDesignsToOrderItems(container, order.id, {
        dryRun: true,
      })
      expect(res.linked).toBe(1)

      const { data: rows } = await query.graph({
        entity: designOrderLineItemLink.entryPoint,
        fields: ["design_id"],
        filters: { order_line_item_id: order.items[0].id },
      })
      expect(rows || []).toHaveLength(0)
    })

    /**
     * The whole point of the phase: an item that has NO product and NO variant
     * still resolves, and resolves via the link rather than the string.
     */
    it("resolves a design-order item that has neither product nor variant", async () => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const a = await makeDesign(`Resolve ${Date.now()}`)
      const order = await makeDesignOrder([a])
      const item = order.items[0]
      expect(item.variant_id ?? null).toBeNull()

      // Before the link: the string is the only answer.
      const before = await resolveLineItemDesignId(query, {
        lineItemId: item.id,
        metadata: item.metadata,
      })
      expect(before.designId).toBe(a)
      expect(before.source).toBe("metadata")

      await linkDesignsToOrderItems(container, order.id)

      const after = await resolveLineItemDesignId(query, {
        lineItemId: item.id,
        metadata: item.metadata,
      })
      expect(after.designId).toBe(a)
      expect(after.source).toBe("link")
    })

    /**
     * #1921's precondition. The string cannot do this at all, which is why a
     * deviated order could not be re-pointed.
     */
    it("re-points an item to a different design, and the link wins over the stale string", async () => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const original = await makeDesign(`Orig ${Date.now()}`)
      const successor = await makeDesign(`Succ ${Date.now()}`)
      const order = await makeDesignOrder([original])
      const item = order.items[0]

      await linkDesignsToOrderItems(container, order.id)
      const moved = await repointOrderItemDesign(container, item.id, successor)
      expect(moved.removed).toBe(1)
      expect(moved.created).toBe(true)

      const after = await resolveLineItemDesignId(query, {
        lineItemId: item.id,
        metadata: item.metadata,
      })
      expect(after.designId).toBe(successor)
      expect(after.source).toBe("link")
      // Provenance survives: the item still records what was ORDERED.
      expect(item.metadata.design_id).toBe(original)
    })

    /**
     * #1918 requires "design-less" to be distinguishable from "never had a
     * design". Unlinked keeps its provenance string; never-had has neither.
     */
    it("unlinks to design-less, and that is distinguishable from never having one", async () => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const a = await makeDesign(`Unlink ${Date.now()}`)
      const order = await makeDesignOrder([a])
      const item = order.items[0]

      await linkDesignsToOrderItems(container, order.id)
      const cleared = await repointOrderItemDesign(container, item.id, null)
      expect(cleared.removed).toBe(1)
      expect(cleared.created).toBe(false)

      const { data: rows } = await query.graph({
        entity: designOrderLineItemLink.entryPoint,
        fields: ["design_id"],
        filters: { order_line_item_id: item.id },
      })
      expect(rows || []).toHaveLength(0)
      // Still tells you what it WAS — that is the difference.
      expect(item.metadata.design_id).toBe(a)
    })

    it("reports, rather than links, an item naming a design that no longer exists", async () => {
      const container = getContainer()
      const order = await makeDesignOrder(["design_does_not_exist_01"])

      const res = await linkDesignsToOrderItems(container, order.id)
      expect(res.linked).toBe(0)
      expect(res.unresolved).toHaveLength(1)
      expect(res.unresolved[0].reason).toMatch(/no longer exists/)
    })

    /**
     * #1918 — the HTTP door onto the link, and the notice that goes with it.
     *
     * ⚠️ These exercise a DIFFERENT layer from the cases above, and the two
     * behave differently on purpose:
     *
     *   · `repointOrderItemDesign` (above) moves the LINK only. The item's
     *     `metadata.design_id` is left exactly as it was — which is what the
     *     "provenance survives" assertions there are about.
     *
     *   · `POST .../design` (here) additionally brings `metadata.design_id`
     *     into step with the link, because partner-ui still reads that string
     *     over HTTP and cannot be migrated yet. Provenance moves to
     *     `original_design_id` rather than being lost.
     *
     * A reader who assumes the metadata rule from the cases above will be
     * wrong about this one, so both are asserted rather than inferred.
     */
    describe("#1918 — POST /admin/designs/orders/:lineItemId/design", () => {
      /** Read the item back FROM THE DATABASE, never from the create response. */
      const readItem = async (orderId: string, itemId: string) => {
        const container = getContainer()
        const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "order",
          fields: ["id", "items.id", "items.metadata"],
          filters: { id: orderId },
        })
        return (data?.[0]?.items || []).find((i: any) => i.id === itemId)
      }

      const linkRows = async (itemId: string) => {
        const container = getContainer()
        const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: designOrderLineItemLink.entryPoint,
          fields: ["design_id"],
          filters: { order_line_item_id: itemId },
        })
        return data || []
      }

      it("requires design_id — omitting it is NOT a detach", async () => {
        const a = await makeDesign(`Route Req ${Date.now()}`)
        const order = await makeDesignOrder([a])
        const err = await api
          .post(
            `/admin/designs/orders/${order.items[0].id}/design`,
            {},
            adminHeaders
          )
          .catch((e: any) => e.response)
        // A forgotten field must never silently unlink a paid-for garment.
        expect(err.status).toBe(400)
        expect(await linkRows(order.items[0].id)).toHaveLength(0)
      })

      it("404s on a design that does not exist, and writes nothing", async () => {
        const a = await makeDesign(`Route 404 ${Date.now()}`)
        const order = await makeDesignOrder([a])
        const container = getContainer()
        await linkDesignsToOrderItems(container, order.id)

        const err = await api
          .post(
            `/admin/designs/orders/${order.items[0].id}/design`,
            { design_id: "01DESIGN_DOES_NOT_EXIST", notify: false },
            adminHeaders
          )
          .catch((e: any) => e.response)
        expect(err.status).toBe(404)
        // The original link is untouched.
        const rows = await linkRows(order.items[0].id)
        expect(rows.map((r: any) => r.design_id)).toEqual([a])
      })

      it("dry_run reports the change and writes NOTHING", async () => {
        const a = await makeDesign(`Route Dry A ${Date.now()}`)
        const b = await makeDesign(`Route Dry B ${Date.now()}`)
        const order = await makeDesignOrder([a])
        const item = order.items[0]
        await linkDesignsToOrderItems(getContainer(), order.id)

        const res = await api.post(
          `/admin/designs/orders/${item.id}/design`,
          { design_id: b, dry_run: true },
          adminHeaders
        )
        expect(res.status).toBe(200)
        expect(res.data.action).toBe("replaced")
        expect(res.data.dry_run).toBe(true)
        expect(res.data.email.sent).toBe(false)
        expect(res.data.metadata_updated).toBe(false)

        // Nothing moved.
        const rows = await linkRows(item.id)
        expect(rows.map((r: any) => r.design_id)).toEqual([a])
        expect((await readItem(order.id, item.id)).metadata.design_id).toBe(a)
      })

      it("attaches, and brings metadata.design_id into step with the link", async () => {
        const a = await makeDesign(`Route Att A ${Date.now()}`)
        const b = await makeDesign(`Route Att B ${Date.now()}`)
        const order = await makeDesignOrder([a])
        const item = order.items[0]
        await linkDesignsToOrderItems(getContainer(), order.id)

        const res = await api.post(
          `/admin/designs/orders/${item.id}/design`,
          { design_id: b, notify: false },
          adminHeaders
        )
        expect(res.status).toBe(200)
        expect(res.data.action).toBe("replaced")
        expect(res.data.previous_design_id).toBe(a)
        expect(res.data.previous_design_source).toBe("link")
        expect(res.data.metadata_updated).toBe(true)

        const rows = await linkRows(item.id)
        expect(rows.map((r: any) => r.design_id)).toEqual([b])

        const stored = await readItem(order.id, item.id)
        expect(stored.metadata.design_id).toBe(b)
        // Provenance is not lost — it moves, it does not disappear.
        expect(stored.metadata.original_design_id).toBe(a)
      })

      it("detaches: link gone, design_id null, provenance kept", async () => {
        const a = await makeDesign(`Route Det ${Date.now()}`)
        const order = await makeDesignOrder([a])
        const item = order.items[0]
        await linkDesignsToOrderItems(getContainer(), order.id)

        const res = await api.post(
          `/admin/designs/orders/${item.id}/design`,
          { design_id: null, notify: false },
          adminHeaders
        )
        expect(res.status).toBe(200)
        expect(res.data.action).toBe("detached")
        expect(res.data.new_design_id).toBeNull()

        expect(await linkRows(item.id)).toHaveLength(0)

        const stored = await readItem(order.id, item.id)
        /**
         * NULL, not absent. `updateOrderLineItems` MERGES metadata and cannot
         * remove a key — a `delete` on the payload is silently ignored. Both
         * in-repo readers guard on `typeof === "string"`, so a null correctly
         * stops resolving.
         */
        expect(stored.metadata.design_id).toBeNull()
        expect(stored.metadata.original_design_id).toBe(a)
      })

      it("🔴 keeps the FIRST design as provenance across repeated re-points", async () => {
        const first = await makeDesign(`Route P1 ${Date.now()}`)
        const second = await makeDesign(`Route P2 ${Date.now()}`)
        const third = await makeDesign(`Route P3 ${Date.now()}`)
        const order = await makeDesignOrder([first])
        const item = order.items[0]
        await linkDesignsToOrderItems(getContainer(), order.id)

        for (const d of [second, third]) {
          const r = await api.post(
            `/admin/designs/orders/${item.id}/design`,
            { design_id: d, notify: false },
            adminHeaders
          )
          expect(r.status).toBe(200)
        }

        const stored = await readItem(order.id, item.id)
        expect(stored.metadata.design_id).toBe(third)
        // "What did the customer order?" has ONE answer however often it moves.
        expect(stored.metadata.original_design_id).toBe(first)
      })

      it("🔴 does not claim production for an item with no run", async () => {
        const a = await makeDesign(`Route Notice A ${Date.now()}`)
        const b = await makeDesign(`Route Notice B ${Date.now()}`)
        const order = await makeDesignOrder([a])
        const item = order.items[0]
        await linkDesignsToOrderItems(getContainer(), order.id)

        const res = await api.post(
          `/admin/designs/orders/${item.id}/design`,
          { design_id: b, notify: false },
          adminHeaders
        )
        const line = res.data.notice.changed_lines[0]
        // This is the state four of Aline's five items are in.
        expect(line.production_state).toBe("not_started")
        expect(line.reassuring).toBe(false)
        expect(res.data.notice.all_in_hand).toBe(false)
        expect(res.data.notice.headline).not.toMatch(/already in hand/i)
      })

      it("resolves a pre-backfill item from its metadata, not as design-less", async () => {
        const a = await makeDesign(`Route Pre ${Date.now()}`)
        const b = await makeDesign(`Route Pre B ${Date.now()}`)
        // NOTE: linkDesignsToOrderItems deliberately NOT run — this item has a
        // metadata string and no link, exactly like anything predating #1919.
        const order = await makeDesignOrder([a])
        const item = order.items[0]

        const res = await api.post(
          `/admin/designs/orders/${item.id}/design`,
          { design_id: b, notify: false },
          adminHeaders
        )
        expect(res.status).toBe(200)
        // Reading the LINK alone would report "attached" and lose the fact that
        // a design was already there.
        expect(res.data.action).toBe("replaced")
        expect(res.data.previous_design_id).toBe(a)
        expect(res.data.previous_design_source).toBe("metadata")
      })
    })
  })
})
