/**
 * Two routes give a partner an order. Only the silent one was on the MCP (#1909).
 *
 * `POST /admin/inventory-orders/:id/assign-partner` (#1737) writes the
 * `partner-inventory-order` link and NOTHING else — no event, no notification,
 * no workflow, no status change. Its own docblock says so, and says why: it
 * exists for backfilling work already done, where messaging a partner about a
 * five-month-old delivery would be wrong.
 *
 * `POST /admin/inventory-orders/:id/send-to-partner` writes the same link AND
 * emits `inventory_order_assigned_to_partner` — which a subscriber turns into a
 * real message — AND parks `awaitOrderStart` / `awaitOrderCompletion`. It is
 * the one that commissions work, and it is refused unless the order is Pending.
 *
 * Only `assign_inventory_order_partner` was registered. Its description sold it
 * as "what makes the order appear in that partner's portal and in their
 * payables" — all true, and silent about the half that matters. So an agent
 * asked to give GOF an order used it, every view showed the order as assigned,
 * and GOF was never told. That is the state `inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF`
 * sat in: `notified: false`, correct-looking everywhere.
 *
 * A capability whose only door is the inert half of a pair is worse than a
 * missing one: it succeeds.
 */
import { ADMIN_MCP_TOOLS } from "../registry"
import { mcpToolTier } from "../../../../../lib/mcp-core/tiers"

const byName = (n: string) => ADMIN_MCP_TOOLS.find((t) => t.name === n)!

describe("commissioning vs recording a partner order (#1909)", () => {
  it("registers the commissioning tool, wrapping the send-to-partner route", () => {
    expect(byName("send_inventory_order_to_partner")).toMatchObject({
      method: "POST",
      path: "/admin/inventory-orders/:id/send-to-partner",
      write: true,
      sensitive: true,
    })
  })

  it("forwards the route's OWN camelCase field name", () => {
    // send-to-partner takes `partnerId`; assign-partner takes `partner_id`.
    // The two sit next to each other and disagree, so the mismatch is a live
    // trap: `bodyParams` is the forward list, and a name the route does not
    // read is dropped in silence — the call would succeed and commission
    // nobody.
    const def = byName("send_inventory_order_to_partner")
    expect(def.bodyParams).toEqual(["partnerId", "notes"])
    expect(def.bodyParams).not.toContain("partner_id")
    expect(Object.keys((def.inputSchema as any).properties)).toContain("partnerId")
    expect(def.inputSchema.required).toEqual(["id", "partnerId"])
  })

  it("keeps the two neighbours on their own field names", () => {
    expect(byName("assign_inventory_order_partner").bodyParams).toEqual([
      "partner_id",
    ])
  })

  it("is NOT demoted to write tier — it messages a third party", () => {
    // The tool-tiers roster is explicitly limited to tools with no money, no
    // carrier and no third-party message. This one notifies a partner, so a
    // write-scoped credential must not reach it.
    const def = byName("send_inventory_order_to_partner")
    expect(def.tier).toBeUndefined()
    expect(mcpToolTier(def)).not.toBe("write")
  })

  it("says out loud that the recording tool commissions nothing", () => {
    const d = byName("assign_inventory_order_partner").description
    expect(d).toMatch(/COMMISSIONS NOTHING/)
    expect(d).toMatch(/not told/i)
  })

  it("makes each tool name the other, so the wrong one is a dead end", () => {
    // Discoverability is the whole defect: the silent tool was reachable and
    // the loud one was not, and nothing said they were a pair.
    expect(byName("assign_inventory_order_partner").description).toContain(
      "send_inventory_order_to_partner"
    )
    expect(byName("send_inventory_order_to_partner").description).toContain(
      "assign_inventory_order_partner"
    )
  })

  it("states the status gate and the irreversibility", () => {
    const def = byName("send_inventory_order_to_partner")
    // The workflow throws unless the order is Pending; a model that does not
    // know this reads the failure as a broken tool.
    expect(def.description).toMatch(/Pending/)
    expect(def.sideEffects).toMatch(/cannot be recalled/i)
    // Lines first: the partner is messaged about the order as it stands.
    expect(def.description).toMatch(/update_inventory_order_lines/)
  })

  it("registers ready-for-delivery with its Partial-only gate", () => {
    const def = byName("mark_inventory_order_ready_for_delivery")
    expect(def).toMatchObject({
      method: "POST",
      path: "/admin/inventory-orders/:id/ready-for-delivery",
      write: true,
      sensitive: true,
    })
    expect(def.description).toMatch(/Partial/)
    // A status-only route takes no body; forwarding anything would 400 or lie.
    expect(def.bodyParams ?? []).toEqual([])
  })
})
