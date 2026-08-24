import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import {
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"

jest.setTimeout(240 * 1000)

/**
 * The partner MCP quote tools, CALLED (#1452).
 *
 * ## Why this file exists
 *
 * The tools were built, reviewed, unit-tested for field coverage, and shipped.
 * None had ever been executed. `tools/list` answering is the evidence this repo
 * has already learned not to accept twice:
 *
 * - #1394 shipped **three** partner tools that listed perfectly and could never
 *   succeed, because the `required` array they were gated on was itself the
 *   lie;
 * - the "Admin MCP works with a secret key" claim was retracted after it turned
 *   out `tools/list` had worked and **no tool call had ever run**.
 *
 * A field-coverage unit test (`quote-tool-field-coverage.unit.spec.ts`) proves
 * the registry rows and the validators agree about the *vocabulary*. It cannot
 * prove the dispatcher reaches the route, that the loopback carries the
 * partner's bearer, that the confirm rail fires on the one tool that emails a
 * buyer, or that a field the model sends arrives intact — an MCP field missing
 * from `bodyParams` is dropped in SILENCE, and `dry_run` cannot reveal it.
 *
 * So every assertion below is downstream of a real `tools/call`.
 *
 * ## Carrier
 *
 * `carrier: "manual"` for the same reason as the mint suite: it is not a
 * supported carrier, so freight comes from the store's own flat-priced options
 * and the suite never touches the network.
 */

/** Streamable HTTP wants both content types; the transport answers JSON. */
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
  describe("POST /partners/mcp — the quote tools, executed (#1452)", () => {
    let seed: QuoteFixture

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
    })

    const mcp = (body: any) => {
      const { api } = getSharedTestEnv()
      return api.post("/partners/mcp", body, {
        headers: { ...MCP_HEADERS, ...seed.headers },
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
      const payload = JSON.parse(text)
      if (payload.ok === false) {
        console.log(`[${name}] tool refused:`, JSON.stringify(payload).slice(0, 800))
      }
      return payload
    }

    const basket = (overrides: Record<string, unknown> = {}) => ({
      lines: [
        { variant_id: seed.variantA.id, quantity: 25 },
        { variant_id: seed.variantB.id, quantity: 4 },
      ],
      destination_country_code: "in",
      destination_postal_code: "400001",
      destination_city: "Mumbai",
      currency_code: seed.currencyCode,
      region_id: seed.regionId,
      carrier: "manual",
      ...overrides,
    })

    it("lists every quote tool, with the preflight ahead of the mint", async () => {
      const res = await mcp(rpc("tools/list", {}))
      expect(res.status).toBe(200)
      const names: string[] = (res.data?.result?.tools ?? []).map((t: any) => t.name)

      for (const name of [
        "list_quotes",
        "get_quote",
        "list_quotable_designs",
        "check_quote_readiness",
        "mint_quote",
        // #1517: the withdraw half of the mint. Its absence is what made
        // `mint_quote`'s guidance unexecutable.
        "revoke_quote",
      ]) {
        expect(names).toContain(name)
      }

      // 🔑 Order is the whole trick (#1452): the read that documents the ranges
      // is listed before the write that enforces them, so a model reading the
      // list top-down meets the rehearsal first.
      expect(names.indexOf("check_quote_readiness")).toBeLessThan(
        names.indexOf("mint_quote")
      )
    })

    it("🔴 check_quote_readiness RUNS — prices the basket and rates freight without minting", async () => {
      const payload = await call("check_quote_readiness", basket())

      expect(payload.ok).toBe(true)
      expect(payload.tool).toBe("check_quote_readiness")
      expect(payload.data?.readiness?.ready).toBe(true)

      // It is a POST that is not a write: no confirm rail, and nothing written.
      expect(payload.requires_confirmation).toBeUndefined()

      const before = await call("list_quotes", { limit: 50 })
      expect(before.ok).toBe(true)
      expect(Array.isArray(before.data?.quotes)).toBe(true)
      expect(before.data.quotes.length).toBe(0)
    })

    it("names the blocking problem rather than refusing vaguely", async () => {
      const payload = await call(
        "check_quote_readiness",
        basket({ lines: [{ variant_id: "variant_does_not_exist", quantity: 1 }] })
      )

      // Either shape is acceptable — a refusal or a not-ready report — but it
      // must NAME the variant. A model that gets "invalid request" cannot fix
      // its own call, and will retry the same one.
      const blob = JSON.stringify(payload)
      expect(blob).toContain("variant_does_not_exist")
    })

    it("🔴 mint_quote stops at the confirm rail — the buyer is not emailed on a first call", async () => {
      const payload = await call(
        "mint_quote",
        basket({ buyer_email: `mcp-gate-${seed.unique}@jaalyantra.test` })
      )

      // `sensitive: true` exists for this: by the time anyone notices a bad
      // mint, the buyer has already been told a number.
      expect(payload.requires_confirmation).toBe(true)
      expect(payload.plan?.method).toBe("POST")
      expect(payload.plan?.path).toBe("/partners/quotes")

      const listed = await call("list_quotes", { limit: 50 })
      expect(listed.data.quotes.length).toBe(0)
    })

    /**
     * 🔴 Mint, read back, and search — all in ONE test, on purpose.
     *
     * The runner restores a database snapshot before EVERY test, so a quote
     * created in one `it` does not exist in the next. Split across tests this
     * reads as "the mint returned an id and `list_quotes` cannot see it" — a
     * convincing, entirely false, bug report. It cost this file two runs.
     */
    it("🔴 mint_quote EXECUTES on confirm — every field survives the dispatcher, and the quote is readable back", async () => {
      const buyerEmail = `mcp-mint-${seed.unique}@jaalyantra.test`
      const payload = await call("mint_quote", {
        ...basket({ buyer_email: buyerEmail }),
        recipient_name: "MCP Buyer",
        recipient_company: "MCP Buyer Pvt Ltd",
        partner_note: "minted through the partner MCP",
        ttl_days: 5,
        deposit_pct: 40,
        confirm: true,
      })

      expect(payload.ok).toBe(true)
      const quote = payload.data?.quote
      expect(quote?.id).toBeTruthy()

      // The buyer is a customer row, not a column — see the search assertion
      // at the end of this test for what that costs a model.
      expect(quote.customer_id).toBeTruthy()
      expect(quote.recipient_company).toBe("MCP Buyer Pvt Ltd")

      /**
       * 🔑 The assertion the field-coverage unit test cannot make.
       *
       * A field missing from `bodyParams` is stripped in SILENCE — the mint
       * still returns 201, just with the platform default in place of what the
       * model asked for. So these are checked on the STORED quote, not on the
       * request: `deposit_pct` would read 30 and the expiry would sit at the
       * platform TTL if either had been dropped in transit.
       */
      expect(quote.deposit_pct).toBe(40)
      expect(quote.partner_note).toBe("minted through the partner MCP")

      const ttlDays =
        (new Date(quote.expires_at).getTime() - new Date(quote.created_at).getTime()) /
        86_400_000
      expect(Math.round(ttlDays)).toBe(5)

      // --- read it back through the tools a model would actually use --------

      const listed = await call("list_quotes", { limit: 50 })
      expect(listed.ok).toBe(true)
      expect((listed.data.quotes as any[]).some((q) => q.id === quote.id)).toBe(true)

      const one = await call("get_quote", { id: quote.id })
      expect(one.ok).toBe(true)
      expect(one.data?.quote?.id).toBe(quote.id)
      // The full view, not the list row — this is what a model answers from.
      expect(Array.isArray(one.data.quote.lines)).toBe(true)
      expect(one.data.quote.lines.length).toBe(2)

      /**
       * 🔑 A model is asked *"what did we quote foo@bar.com?"*, and the quote
       * has no `buyer_email` column — the buyer is a `customer_id`. The search
       * still answers, because `buildQuoteSearchFilter` matches
       * `email_sent_to` alongside the recipient text. Asserted rather than
       * assumed: that field is populated by the DELIVERY, so a quote whose
       * email never went out is not findable this way, and the tools give a
       * model no other route from an address to a quote.
       */
      const byEmail = await call("list_quotes", { q: buyerEmail, limit: 50 })
      expect(byEmail.ok).toBe(true)
      expect((byEmail.data.quotes as any[]).some((q) => q.id === quote.id)).toBe(true)

      const byCompany = await call("list_quotes", { q: "MCP Buyer Pvt Ltd", limit: 50 })
      expect(byCompany.ok).toBe(true)
      expect((byCompany.data.quotes as any[]).some((q) => q.id === quote.id)).toBe(true)
    })

    /**
     * 🔴 Mint then revoke in ONE test — same snapshot rule as the mint above.
     *
     * This is the tool #1452 asked for and #1517 built the route under. Its
     * absence is why `mint_quote` shipped guidance telling the model to
     * "revoke the old quote first": a prescribed action no tool on this
     * surface could perform, which is #1394's shape exactly.
     */
    it("🔴 revoke_quote EXECUTES — the confirm rail fires, then the quote is revoked", async () => {
      const minted = await call("mint_quote", {
        ...basket({ buyer_email: `mcp-revoke-${seed.unique}@jaalyantra.test` }),
        confirm: true,
      })
      expect(minted.ok).toBe(true)
      const quoteId = minted.data?.quote?.id
      expect(quoteId).toBeTruthy()

      // `sensitive: true`: the buyer has already been told a number, and this
      // deletes the price list behind it.
      const gated = await call("revoke_quote", { id: quoteId })
      expect(gated.requires_confirmation).toBe(true)
      expect(gated.plan?.method).toBe("POST")
      expect(gated.plan?.path).toBe(`/partners/quotes/${quoteId}/revoke`)

      // Rehearsal only — nothing happened yet.
      const stillActive = await call("get_quote", { id: quoteId })
      expect(stillActive.data.quote.status).toBe("active")

      const done = await call("revoke_quote", { id: quoteId, confirm: true })
      expect(done.ok).toBe(true)
      expect(done.data?.price_list_deleted).toBe(true)

      // Asserted through the tool a model would actually read it back with,
      // not on the revoke's own response — the route could report a revoke it
      // did not persist and nothing here would differ.
      const after = await call("get_quote", { id: quoteId })
      expect(after.data.quote.status).toBe("revoked")
    })

    it("list_quotable_designs answers, so a design named in conversation can become a line", async () => {
      const payload = await call("list_quotable_designs", { limit: 5 })
      expect(payload.ok).toBe(true)
      expect(Array.isArray(payload.data?.designs)).toBe(true)
    })
  })
})
