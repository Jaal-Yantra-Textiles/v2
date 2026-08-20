import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(120000)

/**
 * #1371 item 3 — the confirm gate must not preview a call that cannot run.
 *
 * An argument-less `create_product` used to come back as a `requires_confirmation`
 * plan, render an Approve card, and only 400 at the route *after* the partner
 * pressed it. The dispatcher now refuses on any absent `inputSchema.required`
 * argument ahead of every rail.
 *
 * The unit suite (`src/lib/mcp-core/__tests__/required-args.unit.spec.ts`) holds
 * the registry contract and calls the dispatcher directly. This one drives the
 * real HTTP surfaces end to end — BOTH of them, because the fix lives in shared
 * mcp-core and a surface could regress independently. The partner MCP route had
 * no HTTP coverage at all before this.
 *
 * Note the refusal happens before any loopback call, so neither case touches a
 * route and nothing is ever written.
 */
const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
}

const rpc = (name: string, args: Record<string, unknown>, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
})

const TEST_PARTNER_PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  describe("MCP required-argument refusal (#1371 item 3)", () => {
    const { api, getContainer } = getSharedTestEnv()

    const parse = (res: any) => JSON.parse(res.data.result.content[0].text)

    describe("admin surface — POST /admin/mcp", () => {
      let auth: { headers: Record<string, string> }

      beforeEach(async () => {
        await createAdminUser(getContainer())
        auth = await getAuthHeaders(api)
      })

      const mcp = (body: any) =>
        api.post("/admin/mcp", body, {
          headers: { ...MCP_HEADERS, ...auth.headers },
        })

      it("refuses create_product with no arguments instead of asking to confirm", async () => {
        const res = await mcp(rpc("create_product", {}))
        expect(res.status).toBe(200)
        expect(res.data.result.isError).toBe(true)

        const out = parse(res)
        expect(out.ok).toBe(false)
        expect(out.tool).toBe("create_product")
        expect(out.error).toMatch(/required argument/i)
        expect(out.error).toMatch(/title/)
        // The regression: never an approval card for a call that cannot run.
        expect(out.requires_confirmation).toBeUndefined()
        expect(out.plan).toBeUndefined()
      })

      it("still reaches the sensitive rail once the required argument is present", async () => {
        const res = await mcp(
          rpc("create_product", { title: "req-args-probe", dry_run: true })
        )
        const out = parse(res)
        expect(out.ok).toBe(true)
        expect(out.dry_run).toBe(true)
        expect(out.plan.body.title).toBe("req-args-probe")
        expect(out.warning).toMatch(/sensitive/i)
      })
    })

    describe("partner surface — POST /partners/mcp", () => {
      let headers: Record<string, string>

      beforeEach(async () => {
        const unique = Date.now() + Math.random().toString(36).slice(2, 6)
        const email = `partner-reqargs-${unique}@medusa-test.com`

        await api.post("/auth/partner/emailpass/register", {
          email,
          password: TEST_PARTNER_PASSWORD,
        })
        const login1 = await api.post("/auth/partner/emailpass", {
          email,
          password: TEST_PARTNER_PASSWORD,
        })
        await api.post(
          "/partners",
          {
            name: `ReqArgs ${unique}`,
            handle: `reqargs-${unique}`,
            admin: { email, first_name: "Req", last_name: "Args" },
          },
          { headers: { Authorization: `Bearer ${login1.data.token}` } }
        )
        // Re-login so the token carries the partner in app_metadata.
        const login2 = await api.post("/auth/partner/emailpass", {
          email,
          password: TEST_PARTNER_PASSWORD,
        })
        headers = { Authorization: `Bearer ${login2.data.token}` }
      })

      const mcp = (body: any) =>
        api.post("/partners/mcp", body, {
          headers: { ...MCP_HEADERS, ...headers },
        })

      it("refuses create_product with no arguments and names BOTH missing fields", async () => {
        const res = await mcp(rpc("create_product", {}))
        expect(res.status).toBe(200)
        expect(res.data.result.isError).toBe(true)

        const out = parse(res)
        expect(out.ok).toBe(false)
        expect(out.error).toMatch(/store_id/)
        expect(out.error).toMatch(/product/)
        expect(out.requires_confirmation).toBeUndefined()
        expect(out.plan).toBeUndefined()
      })

      it("refuses even when the model supplies confirm: true", async () => {
        const out = parse(await mcp(rpc("create_product", { confirm: true })))
        expect(out.ok).toBe(false)
        expect(out.error).toMatch(/required argument/i)
      })

      it("treats an empty-string argument as missing", async () => {
        const out = parse(
          await mcp(
            rpc("create_product", {
              store_id: "   ",
              product: { title: "x" },
            })
          )
        )
        expect(out.ok).toBe(false)
        expect(out.error).toMatch(/store_id/)
      })
    })
  })
})
