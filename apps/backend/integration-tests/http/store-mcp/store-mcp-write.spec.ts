import { Modules } from "@medusajs/utils"
import { createTestCustomer } from "../../helpers/create-customer"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(120000)

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

/** Call a tool on the gated mount and return the parsed text payload (or throw on in-band error). */
const callTool = async (
  api: any,
  publishableKey: string,
  name: string,
  args: Record<string, unknown>
) => {
  const res = await api.post(
    "/store/mcp",
    rpc("tools/call", { name, arguments: args }),
    { headers: { ...MCP_HEADERS, "x-publishable-api-key": publishableKey } }
  )
  expect(res.status).toBe(200)
  if (res.data?.result?.isError) {
    throw new Error(
      `${name} returned in-band error: ${res.data.result.content?.[0]?.text}`
    )
  }
  return JSON.parse(res.data.result.content[0].text)
}

setupSharedTestSuite(() => {
  describe("Store MCP server — write (cart/checkout) tools", () => {
    const { api, getContainer } = getSharedTestEnv()

    let publishableKey: string
    let regionId: string

    beforeEach(async () => {
      const { apiKey } = await createTestCustomer(getContainer())
      publishableKey = apiKey.token
      // The shared env doesn't seed a region; create one so cart/pricing context
      // is well-defined (mirrors convert-design-order.spec.ts).
      const regionService = getContainer().resolve(Modules.REGION) as any
      const region = await regionService.createRegions({
        name: "MCP Test Region",
        currency_code: "usd",
        countries: ["us"],
      })
      regionId = region.id
    })

    afterEach(() => {
      delete process.env.STORE_MCP_ENABLE_WRITE
    })

    it("hides write tools from tools/list when STORE_MCP_ENABLE_WRITE is off", async () => {
      delete process.env.STORE_MCP_ENABLE_WRITE
      const res = await api.post("/mcp", rpc("tools/list", {}), {
        headers: MCP_HEADERS,
      })
      expect(res.status).toBe(200)
      const names = (res.data?.result?.tools ?? []).map((t: any) => t.name)
      // Read tools are still present...
      expect(names).toContain("list_products")
      // ...but every write tool is hidden.
      expect(names).not.toContain("create_cart")
      expect(names).not.toContain("complete_cart")
      expect(names).not.toContain("add_line_item")
    })

    it("rejects a write tool call with an in-band error when writes are off", async () => {
      delete process.env.STORE_MCP_ENABLE_WRITE
      const res = await api.post(
        "/store/mcp",
        rpc("tools/call", { name: "create_cart", arguments: {} }),
        { headers: { ...MCP_HEADERS, "x-publishable-api-key": publishableKey } }
      )
      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBe(true)
      expect(res.data.result.content[0].text).toMatch(/STORE_MCP_ENABLE_WRITE/)
    })

    it("exposes write tools in tools/list when STORE_MCP_ENABLE_WRITE is on", async () => {
      process.env.STORE_MCP_ENABLE_WRITE = "true"
      const res = await api.post("/mcp", rpc("tools/list", {}), {
        headers: MCP_HEADERS,
      })
      expect(res.status).toBe(200)
      const names = (res.data?.result?.tools ?? []).map((t: any) => t.name)
      for (const t of [
        "create_cart",
        "get_cart",
        "add_line_item",
        "update_cart",
        "list_shipping_options",
        "add_shipping_method",
        "list_payment_providers",
        "create_payment_collection",
        "initialize_payment_session",
        "complete_cart",
        "payu_generate_upi_intent",
        "payu_complete_payment",
        "payu_refresh_payment",
      ]) {
        expect(names).toContain(t)
      }
    })

    it("PayU tools are gated with the rest of the write surface", async () => {
      delete process.env.STORE_MCP_ENABLE_WRITE
      const res = await api.post("/mcp", rpc("tools/list", {}), {
        headers: MCP_HEADERS,
      })
      const names = (res.data?.result?.tools ?? []).map((t: any) => t.name)
      expect(names).not.toContain("payu_complete_payment")
      expect(names).not.toContain("payu_refresh_payment")
    })

    it("payu_refresh_payment is wired and proxies POST /store/payu/refresh", async () => {
      process.env.STORE_MCP_ENABLE_WRITE = "true"

      const created = await callTool(api, publishableKey, "create_cart", {
        region_id: regionId,
        email: "payu-buyer@jyt.test",
      })
      const cartId = created.cart.id

      // No PayU collection exists yet, but the route + workflow run and return a
      // 200 message (refresh is a no-op reset). The MCP layer never HTTP-500s.
      const res = await api.post(
        "/store/mcp",
        rpc("tools/call", {
          name: "payu_refresh_payment",
          arguments: { cart_id: cartId },
        }),
        { headers: { ...MCP_HEADERS, "x-publishable-api-key": publishableKey } }
      )
      expect(res.status).toBe(200)
      expect(Array.isArray(res.data?.result?.content)).toBe(true)
    })

    it("payu_complete_payment requires cart_id (validation surfaces in-band)", async () => {
      process.env.STORE_MCP_ENABLE_WRITE = "true"
      const res = await api.post(
        "/store/mcp",
        rpc("tools/call", {
          name: "payu_complete_payment",
          arguments: { payu_status: "success" },
        }),
        { headers: { ...MCP_HEADERS, "x-publishable-api-key": publishableKey } }
      )
      // Missing `cart_id` → the /store/payu/complete route 400s, which the proxy
      // surfaces as an in-band MCP error (never a transport-level HTTP 500).
      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBe(true)
    })

    it("create_cart proxies POST /store/carts and returns a cart; get_cart reads it back", async () => {
      process.env.STORE_MCP_ENABLE_WRITE = "true"

      const created = await callTool(api, publishableKey, "create_cart", {
        region_id: regionId,
        email: "mcp-buyer@jyt.test",
      })
      expect(typeof created.cart?.id).toBe("string")
      expect(created.cart.email).toBe("mcp-buyer@jyt.test")

      const fetched = await callTool(api, publishableKey, "get_cart", {
        id: created.cart.id,
      })
      expect(fetched.cart?.id).toBe(created.cart.id)
    })

    it("list_payment_providers is wired for a region (checkout read tool)", async () => {
      process.env.STORE_MCP_ENABLE_WRITE = "true"

      const res = await api.post(
        "/store/mcp",
        rpc("tools/call", {
          name: "list_payment_providers",
          arguments: { region_id: regionId },
        }),
        { headers: { ...MCP_HEADERS, "x-publishable-api-key": publishableKey } }
      )
      // 200 envelope; provider list may be empty if none configured, but it must
      // not HTTP-500 and must return a valid payload shape.
      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBeFalsy()
      const payload = JSON.parse(res.data.result.content[0].text)
      expect(Array.isArray(payload.payment_providers)).toBe(true)
    })
  })
})
