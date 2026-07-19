import {
  dispatchAdminTool,
  buildToolInputSchema,
  isSensitive,
  isDangerous,
} from "../dispatch"
import { ADMIN_MCP_TOOLS } from "../registry"
import {
  dispatchMcpTool,
  type McpContext,
  type McpToolDef,
} from "../../../../../lib/mcp-core"

describe("admin-mcp registry + dispatch", () => {
  describe("Tier 1 shape", () => {
    it("registers get_admin_stats as the read-only grounding tool", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "get_admin_stats")
      expect(def).toBeTruthy()
      expect(def!.method ?? "GET").toBe("GET")
      expect(def!.path).toBe("/admin/mcp/stats")
      expect(isSensitive(def!)).toBe(false)
    })

    it("is entirely read-only (no write/sensitive/dangerous tools in Tier 1)", () => {
      for (const def of ADMIN_MCP_TOOLS) {
        expect(def.write).toBeFalsy()
        expect(isSensitive(def)).toBe(false)
        expect(isDangerous(def)).toBe(false)
        expect(def.method ?? "GET").toBe("GET")
      }
    })

    it("has unique tool names", () => {
      const names = ADMIN_MCP_TOOLS.map((t) => t.name)
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe("framework args — parity with the partner dispatcher", () => {
    it("injects context + dry_run onto EVERY tool's input schema", () => {
      for (const def of ADMIN_MCP_TOOLS) {
        const schema = buildToolInputSchema(def)
        expect(schema.properties.context).toBeDefined()
        expect(schema.properties.context.type).toBe("string")
        expect(schema.properties.dry_run).toBeDefined()
      }
    })

    it("adds neither confirm nor reason to a read tool", () => {
      const schema = buildToolInputSchema(
        ADMIN_MCP_TOOLS.find((t) => t.name === "list_orders")!
      )
      expect(schema.properties.confirm).toBeUndefined()
      expect(schema.properties.reason).toBeUndefined()
    })

    it("echoes context on a read tool's dry-run plan (no network)", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999", bearer: "t" },
        "list_orders",
        { dry_run: true, context: "reviewing recent orders" }
      )
      expect(res.ok).toBe(true)
      expect(res.dry_run).toBe(true)
      expect(res.plan?.context).toBe("reviewing recent orders")
      expect(res.plan?.method).toBe("GET")
      expect(res.plan?.path).toBe("/admin/orders")
    })

    it("returns a soft error for an unknown tool", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "does_not_exist",
        {}
      )
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/unknown tool/i)
    })
  })

  // The `dangerous` rail is the admin surface's third rail. Tier 1 has no
  // dangerous tool yet, so exercise the shared dispatcher directly with a
  // synthetic dangerous def — the exact contract later admin tiers rely on.
  describe("dangerous rail (shared core)", () => {
    const DANGEROUS: McpToolDef[] = [
      {
        name: "settle_reconciliation",
        description: "Settle a payout reconciliation.",
        method: "POST",
        path: "/admin/reconciliations/:id/settle",
        pathParams: ["id"],
        write: true,
        dangerous: true,
        inputSchema: { type: "object", properties: {} },
      },
    ]
    const ctx: McpContext = {
      baseUrl: "http://localhost:9999",
      enableWrite: true,
      enableDangerous: true,
      surface: "admin",
    }

    it("injects BOTH reason and confirm onto a dangerous tool's schema", () => {
      const schema = buildToolInputSchema(DANGEROUS[0])
      expect(schema.properties.reason).toBeDefined()
      expect(schema.properties.confirm).toBeDefined()
    })

    it("refuses to run without a reason (even with confirm=true)", async () => {
      const res = await dispatchMcpTool(ctx, DANGEROUS, "settle_reconciliation", {
        id: "recon_1",
        confirm: true,
      })
      expect(res.ok).toBe(true)
      expect(res.requires_reason).toBe(true)
    })

    it("still requires confirmation when a reason is given", async () => {
      const res = await dispatchMcpTool(ctx, DANGEROUS, "settle_reconciliation", {
        id: "recon_1",
        reason: "month-end close",
      })
      expect(res.requires_confirmation).toBe(true)
    })

    it("is hidden/refused when the surface disables dangerous tools", async () => {
      const res = await dispatchMcpTool(
        { ...ctx, enableDangerous: false },
        DANGEROUS,
        "settle_reconciliation",
        { id: "recon_1", reason: "x", confirm: true }
      )
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/dangerous/i)
    })
  })
})
