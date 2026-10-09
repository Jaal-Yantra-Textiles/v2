/**
 * The balance and sample-approval tools over MCP. Pinned: the forward lists
 * are the routes' own field names (a missing bodyParam is stripped in
 * SILENCE), `confirm` reaches the routes (both refuse without it), and both
 * are confirm-gated and off the write tier, because each asks a buyer for
 * money.
 */
import { ADMIN_MCP_TOOLS } from "../registry"
import { mcpToolTier } from "../../../../../lib/mcp-core/tiers"

const byName = (name: string) => ADMIN_MCP_TOOLS.find((t) => t.name === name)

describe("order balance tools", () => {
  it("raises the balance through the admin balance route, forwarding confirm", () => {
    const d = byName("request_order_balance")!
    expect(d.method).toBe("POST")
    expect(d.path).toBe("/admin/orders/:id/balance")
    expect(d.bodyParams).toEqual(["confirm"])
    expect(d.sensitive).toBe(true)
    expect(mcpToolTier(d)).not.toBe("write")
  })

  it("records a sample verdict with the route's own field names", () => {
    const d = byName("approve_order_sample")!
    expect(d.path).toBe("/admin/orders/:id/sample-approval")
    expect([...d.bodyParams!].sort()).toEqual(
      ["confirm", "decision", "notes", "production_run_id"]
    )
    const props = Object.keys(d.inputSchema.properties ?? {}).filter((k) => k !== "id")
    for (const p of props) expect(d.bodyParams).toContain(p)
    expect(d.sensitive).toBe(true)
    expect(mcpToolTier(d)).not.toBe("write")
  })
})
