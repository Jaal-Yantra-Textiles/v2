/**
 * Contract: a tool's `inputSchema.required` is the ONE declaration of what it
 * must be called with, and the dispatcher enforces it before any rail (#1371).
 *
 * That makes the array load-bearing in a way it was not before: a name in
 * `required` that the model cannot supply now refuses the tool on every call
 * instead of being ignored. These tests hold both ends of that — the registries
 * declare only satisfiable requirements, and the dispatcher refuses rather than
 * previewing when one is absent.
 *
 * Sibling of the #1348 family (an MCP row must match its route's validator);
 * here the row is right and the *call* is empty.
 */
import { dispatchMcpTool } from "../dispatch"
import { buildToolInputSchema } from "../schema"
import type { McpContext, McpToolDef } from "../types"
import { PARTNER_MCP_TOOLS } from "../../../api/partners/mcp/lib/registry"
import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"
import { STORE_MCP_TOOLS } from "../../../api/mcp/lib/registry"

const SURFACES: [string, McpToolDef[]][] = [
  ["partner", PARTNER_MCP_TOOLS as McpToolDef[]],
  ["admin", ADMIN_MCP_TOOLS as McpToolDef[]],
  ["store", STORE_MCP_TOOLS as McpToolDef[]],
]

describe("mcp-core required-argument contract", () => {
  describe.each(SURFACES)("%s registry", (_surface, tools) => {
    it("declares every required arg as a property the model can actually supply", () => {
      const offenders: string[] = []
      for (const def of tools) {
        const required: string[] = def.inputSchema?.required ?? []
        const properties = def.inputSchema?.properties ?? {}
        const undeclared = required.filter((r) => !(r in properties))
        if (undeclared.length) {
          offenders.push(`${def.name}: ${undeclared.join(", ")}`)
        }
      }
      // A required name with no matching property is unsatisfiable — the
      // dispatcher would refuse the tool on every call, forever.
      expect(offenders).toEqual([])
    })

    it("declares every forwarded param as a property too", () => {
      const offenders: string[] = []
      for (const def of tools) {
        // The BUILT schema — framework args (context, dry_run, confirm,
        // reason) are injected, not written into the registry row.
        const properties = buildToolInputSchema(def).properties ?? {}
        const forwarded = [
          ...(def.pathParams ?? []),
          ...(def.queryParams ?? []),
          ...(def.bodyParams ?? []),
        ]
        const undeclared = forwarded.filter((p) => !(p in properties))
        if (undeclared.length) {
          offenders.push(`${def.name}: ${undeclared.join(", ")}`)
        }
      }
      // The #1348 direction: a param the route needs that the schema never
      // offers is silently stripped on every call.
      expect(offenders).toEqual([])
    })
  })

  describe("dispatch refuses instead of previewing", () => {
    const ctx = (): McpContext =>
      ({
        baseUrl: "http://localhost:9000",
        surface: "partner",
        enableWrite: true,
        enableSensitive: true,
      } as unknown as McpContext)

    const createProduct = (PARTNER_MCP_TOOLS as McpToolDef[]).find(
      (t) => t.name === "create_product"
    )!

    it("is a sensitive write requiring store_id and product", () => {
      expect(createProduct.sensitive).toBe(true)
      expect(createProduct.inputSchema.required).toEqual([
        "store_id",
        "product",
      ])
    })

    it("refuses an argument-less create_product rather than asking to confirm", async () => {
      const result: any = await dispatchMcpTool(
        ctx(),
        PARTNER_MCP_TOOLS as McpToolDef[],
        "create_product",
        {}
      )
      expect(result.ok).toBe(false)
      // The regression: this used to come back as an Approve card, and only
      // 400'd after the partner pressed it.
      expect(result.requires_confirmation).toBeUndefined()
      expect(result.error).toMatch(/store_id/)
      expect(result.error).toMatch(/product/)
    })

    it("refuses even when the model passes confirm: true", async () => {
      const result: any = await dispatchMcpTool(
        ctx(),
        PARTNER_MCP_TOOLS as McpToolDef[],
        "create_product",
        { confirm: true }
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/required argument/)
    })

    it("refuses a dry_run that could not run for real", async () => {
      const result: any = await dispatchMcpTool(
        ctx(),
        PARTNER_MCP_TOOLS as McpToolDef[],
        "create_product",
        { dry_run: true }
      )
      expect(result.ok).toBe(false)
      expect(result.dry_run).toBeUndefined()
    })

    it("treats an empty-string argument as missing", async () => {
      const result: any = await dispatchMcpTool(
        ctx(),
        PARTNER_MCP_TOOLS as McpToolDef[],
        "create_product",
        { store_id: "   ", product: { title: "x" } }
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/store_id/)
    })

    it("emits one refused observability event naming the missing args", async () => {
      const events: any[] = []
      const observed = {
        ...ctx(),
        observe: (e: any) => events.push(e),
      } as unknown as McpContext
      await dispatchMcpTool(
        observed,
        PARTNER_MCP_TOOLS as McpToolDef[],
        "create_product",
        {}
      )
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        surface: "partner",
        tool: "create_product",
        executed: false,
        ok: false,
        outcome: "refused",
      })
    })
  })
})
