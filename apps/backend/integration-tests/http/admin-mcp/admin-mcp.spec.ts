import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { AI_USAGE_MODULE } from "../../../src/modules/ai_usage"
import type AiUsageService from "../../../src/modules/ai_usage/service"

jest.setTimeout(120000)

// Streamable HTTP requires the client to accept BOTH json and the SSE stream;
// our transport runs with enableJsonResponse so the body comes back as JSON.
const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
}

const rpc = (method: string, params: Record<string, unknown>, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
})

setupSharedTestSuite(() => {
  describe("Admin MCP (Tier 1 reads + Tier 2 writes + #844 ledger + V4 deprecation)", () => {
    const { api, getContainer } = getSharedTestEnv()

    let auth: { headers: Record<string, string> }

    beforeEach(async () => {
      await createAdminUser(getContainer())
      auth = await getAuthHeaders(api) // { headers: { Authorization } }
    })

    const mcp = (body: any) =>
      api.post("/admin/mcp", body, {
        headers: { ...MCP_HEADERS, ...auth.headers },
      })

    const parse = (res: any) => JSON.parse(res.data.result.content[0].text)

    it("tools/list exposes reads + Tier 2 writes, and hides the dangerous tool by default", async () => {
      const res = await mcp(rpc("tools/list", {}))
      expect(res.status).toBe(200)
      const names = (res.data?.result?.tools ?? []).map((t: any) => t.name)
      // Tier 1 reads
      expect(names).toContain("get_admin_stats")
      expect(names).toContain("list_orders")
      // #844 + carried-over resolver
      expect(names).toContain("get_mcp_usage")
      expect(names).toContain("resolve_admin_query")
      // Tier 2 writes (ADMIN_MCP_ENABLE_WRITE defaults on)
      expect(names).toContain("create_product")
      expect(names).toContain("update_product")
      expect(names).toContain("update_customer")
      // Dangerous: hidden unless ADMIN_MCP_ENABLE_DANGEROUS is enabled
      expect(names).not.toContain("delete_product")
    })

    it("a read tool returns the {ok,tool,data} envelope", async () => {
      const res = await mcp(
        rpc("tools/call", { name: "get_admin_stats", arguments: {} })
      )
      expect(res.status).toBe(200)
      const payload = parse(res)
      expect(payload.ok).toBe(true)
      expect(payload.tool).toBe("get_admin_stats")
      expect(payload.data).toBeDefined()
    })

    it("a Tier 2 write returns requires_confirmation and does NOT execute without confirm", async () => {
      const res = await mcp(
        rpc("tools/call", {
          name: "update_product",
          arguments: { id: "prod_missing", title: "Nope" },
        })
      )
      const payload = parse(res)
      expect(payload.requires_confirmation).toBe(true)
      expect(payload.plan?.method).toBe("POST")
      expect(payload.plan?.path).toBe("/admin/products/prod_missing")
    })

    it("dry_run on a write previews the plan without executing", async () => {
      const res = await mcp(
        rpc("tools/call", {
          name: "update_product",
          arguments: { id: "prod_x", title: "X", dry_run: true },
        })
      )
      const payload = parse(res)
      expect(payload.dry_run).toBe(true)
      expect(payload.plan?.path).toBe("/admin/products/prod_x")
    })

    it("the dangerous tool (delete_product) is refused while ADMIN_MCP_ENABLE_DANGEROUS is off", async () => {
      const res = await mcp(
        rpc("tools/call", {
          name: "delete_product",
          arguments: { id: "prod_x", confirm: true, reason: "test" },
        })
      )
      const payload = parse(res)
      expect(payload.ok).toBe(false)
      expect(payload.error).toMatch(/dangerous/i)
    })

    it("persists every dispatch to the ai_usage ledger and get_mcp_usage reads it back (#844)", async () => {
      await mcp(rpc("tools/call", { name: "get_admin_stats", arguments: {} }))
      await mcp(rpc("tools/call", { name: "list_orders", arguments: { limit: 1 } }))
      // The ledger sink is fire-and-forget — give the async write a tick.
      await new Promise((r) => setTimeout(r, 750))

      const aiUsage = getContainer().resolve(AI_USAGE_MODULE) as AiUsageService
      const { events, count } = await aiUsage.listMcpUsage({ surface: "admin" })
      expect(count).toBeGreaterThan(0)
      expect(events.some((e: any) => e.operation === "mcp:get_admin_stats")).toBe(
        true
      )

      const usage = await mcp(
        rpc("tools/call", {
          name: "get_mcp_usage",
          arguments: { surface: "admin" },
        })
      )
      const payload = parse(usage)
      expect(payload.ok).toBe(true)
      expect(payload.data.usage.by_surface.admin).toBeGreaterThan(0)
    })

    it("V4 admin chat resolve 410s when ADMIN_V4_CHAT_DEPRECATED is set, and the MCP resolver survives", async () => {
      process.env.ADMIN_V4_CHAT_DEPRECATED = "true"
      try {
        const res = await api
          .post(
            "/admin/ai/chat/resolve",
            { query: "list designs" },
            { ...auth, validateStatus: () => true }
          )
          .catch((e: any) => e.response)
        expect(res.status).toBe(410)
        expect(res.data.deprecated).toBe(true)
        expect(res.data.replacement?.resolve_tool).toBe("resolve_admin_query")

        // The capability itself is not gated — the tool still lists.
        const list = await mcp(rpc("tools/list", {}))
        const names = (list.data?.result?.tools ?? []).map((t: any) => t.name)
        expect(names).toContain("resolve_admin_query")
      } finally {
        delete process.env.ADMIN_V4_CHAT_DEPRECATED
      }
    })
  })
})
