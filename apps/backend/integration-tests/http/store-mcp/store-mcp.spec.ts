import { createTestCustomer } from "../../helpers/create-customer"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

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
  describe("Store MCP server", () => {
    const { api, getContainer } = getSharedTestEnv()

    let publishableKey: string

    // Seed in beforeEach, not beforeAll: the Medusa test runner truncates the
    // DB before every test (after the first) and re-runs createDefaultsWorkflow,
    // so a key created in beforeAll would only survive the first test.
    beforeEach(async () => {
      const { apiKey } = await createTestCustomer(getContainer())
      publishableKey = apiKey.token
    })

    it("tools/list returns the catalog tools without a key (open /mcp)", async () => {
      const res = await api.post("/mcp", rpc("tools/list", {}), {
        headers: MCP_HEADERS,
      })

      expect(res.status).toBe(200)
      const tools = res.data?.result?.tools ?? []
      const names = tools.map((t: any) => t.name)
      expect(names).toContain("list_products")
      expect(names).toContain("get_product")
      // Input schemas are surfaced to clients verbatim.
      const getProduct = tools.find((t: any) => t.name === "get_product")
      expect(getProduct.inputSchema.required).toContain("id")
    })

    it("every read-only list tool returns a valid 200 envelope under the key", async () => {
      const listTools = [
        "list_collections",
        "list_categories",
        "list_product_tags",
        "list_product_types",
        "list_product_variants",
        "list_regions",
        "list_currencies",
        "list_return_reasons",
        "list_raw_materials",
      ]
      for (const name of listTools) {
        const res = await api.post(
          "/store/mcp",
          rpc("tools/call", { name, arguments: { limit: 2 } }),
          { headers: { ...MCP_HEADERS, "x-publishable-api-key": publishableKey } }
        )
        expect(res.status).toBe(200)
        if (res.data?.result?.isError) {
          // eslint-disable-next-line no-console
          console.log(`[mcp-test] ${name} in-band error:`, res.data.result.content?.[0]?.text)
        }
        expect(res.data?.result?.isError).toBeFalsy()
      }
    })

    it("semantic_search is wired and never HTTP-500s (AI provider optional)", async () => {
      const res = await api.post(
        "/store/mcp",
        rpc("tools/call", { name: "semantic_search", arguments: { query: "cotton" } }),
        { headers: { ...MCP_HEADERS, "x-publishable-api-key": publishableKey } }
      )
      // The MCP layer always answers 200; AI errors surface in-band, not as 500.
      expect(res.status).toBe(200)
      expect(Array.isArray(res.data?.result?.content)).toBe(true)
    })

    it("/store/mcp rejects requests with no publishable key (gated mount)", async () => {
      let status = 0
      try {
        await api.post("/store/mcp", rpc("tools/list", {}), {
          headers: MCP_HEADERS,
        })
      } catch (e: any) {
        status = e?.response?.status ?? 0
      }
      expect([400, 401, 403]).toContain(status)
    })

    it("tools/call list_products proxies to /store/* with the forwarded key", async () => {
      const res = await api.post(
        "/store/mcp",
        rpc("tools/call", {
          name: "list_products",
          arguments: { fields: "id,title,handle", limit: 5 },
        }),
        { headers: { ...MCP_HEADERS, "x-publishable-api-key": publishableKey } }
      )

      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBeFalsy()

      const payload = JSON.parse(res.data.result.content[0].text)
      expect(Array.isArray(payload.products)).toBe(true)
      expect(typeof payload.count).toBe("number")
    })

    it("/mcp injects the default key when none is supplied (zero-config)", async () => {
      process.env.STORE_MCP_DEFAULT_PUBLISHABLE_KEY = publishableKey
      try {
        const res = await api.post(
          "/mcp",
          rpc("tools/call", {
            name: "list_products",
            arguments: { fields: "id,title", limit: 1 },
          }),
          { headers: MCP_HEADERS }
        )

        expect(res.status).toBe(200)
        expect(res.data?.result?.isError).toBeFalsy()
        const payload = JSON.parse(res.data.result.content[0].text)
        expect(Array.isArray(payload.products)).toBe(true)
      } finally {
        delete process.env.STORE_MCP_DEFAULT_PUBLISHABLE_KEY
      }
    })

    it("tools/call without any key returns an in-band error, not HTTP 500", async () => {
      const res = await api.post(
        "/mcp",
        rpc("tools/call", { name: "list_products", arguments: {} }),
        { headers: MCP_HEADERS }
      )

      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBe(true)
      expect(res.data.result.content[0].text).toMatch(/publishable key/i)
    })
  })
})
