import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(240 * 1000)

/**
 * The partner MCP money reads, CALLED (#1712).
 *
 * ## Why a real call, not a plan
 *
 * Two failure modes on this surface are invisible to every unit test:
 *
 *  - a `/partners/*` route 401s until `middlewares.ts` names it explicitly —
 *    auth is per-route here, and both tsc and a green suite stay silent about a
 *    route that answers 401 to every request while looking perfectly correct;
 *  - a read scoped to the AUTHENTICATED partner is only worth what it refuses.
 *    "Takes no partner_id" is a property of the tool row; "cannot see another
 *    partner's money" is a property of the running system, and the second is
 *    the one that matters.
 *
 * So this file authenticates a real partner, has an ADMIN write a credit to
 * each of two partners, and asks the tool what it can see.
 */
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
  describe("POST /partners/mcp — what a partner may see about their own money", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerHeaders: { Authorization: string }
    let partnerId: string
    let otherPartnerId: string

    const registerPartner = async (label: string) => {
      const { api } = getSharedTestEnv()
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const email = `mcp-money-${label}-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      const reg = await api.post("/auth/partner/emailpass", { email, password })
      const created = await api.post(
        "/partners",
        {
          name: `MCP Money ${label} ${unique}`,
          handle: `mcp-money-${label}-${unique}`,
          admin: { email, first_name: "MCP", last_name: "Money" },
        },
        { headers: { Authorization: `Bearer ${reg.data.token}` } }
      )
      expect(created.status).toBe(200)

      // Re-login: a token minted before the partner existed carries no partner
      // claim, so every /partners/* call on it is a 401.
      const login = await api.post("/auth/partner/emailpass", { email, password })
      return {
        id: created.data.partner.id as string,
        headers: { Authorization: `Bearer ${login.data.token}` },
      }
    }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      const mine = await registerPartner("mine")
      partnerId = mine.id
      partnerHeaders = mine.headers

      const theirs = await registerPartner("theirs")
      otherPartnerId = theirs.id
    })

    const mcp = (body: any) => {
      const { api } = getSharedTestEnv()
      return api.post("/partners/mcp", body, {
        headers: { ...MCP_HEADERS, ...partnerHeaders },
      })
    }

    /** The tool envelope, surfaced loudly — a JSON-RPC error hides in `result`. */
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await mcp(rpc("tools/call", { name, arguments: args }))
      expect(res.status).toBe(200)
      const text = res.data?.result?.content?.[0]?.text
      if (typeof text !== "string") {
        throw new Error(
          `[${name}] no tool payload — ${JSON.stringify(res.data).slice(0, 600)}`
        )
      }
      return JSON.parse(text)
    }

    it("advertises the three money reads and no money write", async () => {
      const res = await mcp(rpc("tools/list", {}))
      expect(res.status).toBe(200)
      const tools = res.data?.result?.tools ?? []
      const names = tools.map((t: any) => t.name)

      for (const name of [
        "list_payable_runs",
        "list_payable_inventory_orders",
        "list_credits",
      ]) {
        expect(names).toContain(name)
      }

      /**
       * 🔑 The founder's decision, asserted where it is enforced: a partner must
       * not be able to declare their own payout settled. `tools/list` is what a
       * third-party MCP client actually enumerates.
       */
      expect(names).not.toContain("link_payment_to_payout")
      expect(names).not.toContain("unlink_payment_from_payout")
    })

    it("answers the payable reads for the authenticated partner", async () => {
      const runs = await call("list_payable_runs")
      expect(runs.ok).toBe(true)
      expect(runs.data.payable_runs).toEqual([])

      const orders = await call("list_payable_inventory_orders")
      expect(orders.ok).toBe(true)
      expect(orders.data.count).toBe(0)
    })

    it("shows this partner's credit and NOT another partner's", async () => {
      const { api } = getSharedTestEnv()

      const mine = await api.post(
        `/admin/partners/${partnerId}/credits`,
        {
          amount: 1380,
          source_type: "overpayment",
          reason: "Paid beyond the payout; held against a future delivery.",
        },
        adminHeaders
      )
      expect(mine.status).toBe(201)

      const theirs = await api.post(
        `/admin/partners/${otherPartnerId}/credits`,
        {
          amount: 9999,
          source_type: "goodwill",
          reason: "Somebody else's money entirely.",
        },
        adminHeaders
      )
      expect(theirs.status).toBe(201)

      const payload = await call("list_credits")
      expect(payload.ok).toBe(true)

      const amounts = (payload.data.credits ?? []).map((c: any) =>
        Number(c.amount)
      )
      expect(amounts).toEqual([1380])
      expect(Number(payload.data.open_total)).toBe(1380)
      // The assertion that makes the one above mean something: the other
      // partner's 9,999 exists and is not visible here.
      expect(amounts).not.toContain(9999)
    })
  })
})
