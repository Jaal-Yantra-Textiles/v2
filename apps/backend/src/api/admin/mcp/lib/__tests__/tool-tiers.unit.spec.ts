/**
 * Tier invariants for the admin MCP surface (#1306).
 *
 * The point of these is that a registry edit is the ONLY thing that can change
 * what a scoped credential reaches, and a registry edit is one line. So the
 * dangerous rails, the confirm gate and the shape of the ladder are asserted
 * here rather than left to review.
 */
import { ADMIN_MCP_TOOLS } from "../registry"
import { adminRouteTier, UNCLASSIFIED_ADMIN_ROUTE_TIER } from "../route-tier"
import {
  MCP_SCOPE_LEVELS,
  mcpScopeAllows,
  mcpToolTier,
} from "../../../../../lib/mcp-core/tiers"
import { isSensitive } from "../../../../../lib/mcp-core"
import type { McpScopeLevel } from "../../../../../lib/mcp-core/tiers"

const toolsAt = (level: McpScopeLevel) =>
  ADMIN_MCP_TOOLS.filter((t) => mcpScopeAllows(level, mcpToolTier(t)))

describe("admin MCP tool tiers", () => {
  it("gives the `write` rung more than `read` — the whole reason it exists", () => {
    const read = toolsAt("read").length
    const write = toolsAt("write").length
    // Before the tier axis these were equal (54 and 54), which made `write` a
    // rung an operator could select and get nothing from.
    expect(write).toBeGreaterThan(read)
  })

  it("keeps the ladder monotonic", () => {
    const counts = MCP_SCOPE_LEVELS.map((l) => toolsAt(l).length)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    }
    // Every tool is reachable at the top of the ladder.
    expect(counts[counts.length - 1]).toBe(ADMIN_MCP_TOOLS.length)
  })

  it("never lets a read-scoped credential reach a mutation", () => {
    const leaked = toolsAt("read").filter(
      (t) => t.write || t.method === "DELETE"
    )
    expect(leaked.map((t) => t.name)).toEqual([])
  })

  it("never demotes a dangerous tool, whatever the registry says", () => {
    for (const t of ADMIN_MCP_TOOLS.filter((t) => t.dangerous)) {
      expect(mcpToolTier(t)).toBe("dangerous")
    }
    // Even an explicit attempt to demote one is ignored.
    expect(
      mcpToolTier({
        name: "x",
        description: "",
        inputSchema: {},
        method: "POST",
        path: "/admin/x",
        write: true,
        dangerous: true,
        tier: "write",
      })
    ).toBe("dangerous")
  })

  it("leaves the confirm gate alone — a write-tier tool is still sensitive", () => {
    const writeTier = ADMIN_MCP_TOOLS.filter(
      (t) => mcpToolTier(t) === "write" && t.write
    )
    expect(writeTier.length).toBeGreaterThan(0)
    // Demoting for SCOPE must not have demoted for CONFIRM: these tools still
    // require confirm:true, they are merely reachable by a write-scoped token.
    for (const t of writeTier) {
      expect(isSensitive(t)).toBe(true)
    }
  })

  it("only demotes tools with no money, no carrier and no third-party message", () => {
    // Locked deliberately. Adding a name here is a permission decision, so it
    // should be a visible line in a diff rather than a quiet registry edit.
    expect(
      ADMIN_MCP_TOOLS.filter((t) => t.tier === "write")
        .map((t) => t.name)
        .sort()
    ).toEqual(
      [
        "add_design_construction_detail",
        "add_inventory_raw_material",
        "create_design",
        "create_raw_material_group",
        "link_design_inventory",
        "link_design_material_group",
        "update_design",
        "update_design_brief",
        "update_design_task",
      ].sort()
    )
  })
})

describe("adminRouteTier — the HTTP half of the same rule", () => {
  it("agrees with the tool surface for every wrapped mutation", () => {
    // The guard and `tools/list` must never disagree: a route reachable over
    // HTTP but not through its own tool (or the reverse) is the drift this
    // whole mechanism exists to prevent.
    for (const t of ADMIN_MCP_TOOLS) {
      if (t.native || !t.path || (t.method || "GET") === "GET") continue
      if (t.path.includes("?")) continue
      const concrete = t.path.replace(/:[A-Za-z0-9_]+/g, "sample-id")
      const required = adminRouteTier(t.method!, concrete)
      // The route may require MORE than this tool (another tool can wrap the
      // same path more strictly) but never less.
      expect(mcpScopeAllows(required, mcpToolTier(t))).toBe(true)
    }
  })

  it("fails shut on a mutation no tool classifies", () => {
    expect(adminRouteTier("POST", "/admin/some-route-nobody-wrapped")).toBe(
      UNCLASSIFIED_ADMIN_ROUTE_TIER
    )
    // …and that default is strong enough to stop a write-scoped credential.
    expect(
      mcpScopeAllows("write", adminRouteTier("POST", "/admin/unwrapped"))
    ).toBe(false)
  })

  it("keeps a write-scoped credential off the routes that spend money", () => {
    // The concrete hole this closes: before per-route tiers, ANY write-scoped
    // credential passed the HTTP guard for every admin mutation, including the
    // ones its MCP tool surface refused.
    const label = ADMIN_MCP_TOOLS.find(
      (t) => t.name === "create_order_shipping_label"
    )!
    const path = label.path!.replace(/:[A-Za-z0-9_]+/g, "sample-id")
    expect(mcpScopeAllows("write", adminRouteTier(label.method!, path))).toBe(
      false
    )
    expect(
      mcpScopeAllows("sensitive", adminRouteTier(label.method!, path))
    ).toBe(true)
  })

  it("does not let a path param swallow a separator", () => {
    // `/admin/designs/:id` must not match `/admin/designs/a/tasks/b`.
    const deep = adminRouteTier("POST", "/admin/designs/a/b/c/d/e")
    expect(deep).toBe(UNCLASSIFIED_ADMIN_ROUTE_TIER)
  })
})
