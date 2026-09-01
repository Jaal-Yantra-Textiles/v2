/**
 * The partner-money MCP surface (#1712): ledger, payable work, payable goods,
 * credits, and the admin-only settlement link.
 *
 * ## Why this file exists rather than trusting the registry invariants
 *
 * The generic specs prove a row is WELL-FORMED — classified, tiered, its
 * bodyParams inside its validator. None of them prove a row does the thing it
 * was added for, and this domain is the one where a well-formed row that
 * forwards the wrong field pays the wrong person:
 *
 *  - `pick()` is an allowlist walk, so a `payment_submission_id` that reached
 *    neither `queryParams` nor `bodyParams` would be dropped in SILENCE — the
 *    route would then read an empty submission id and 400, or worse, a future
 *    edit to the route's argument source would turn it into a no-op 200.
 *  - a `partner_id` that stopped being required on `payable-runs` would return
 *    every completed run on the platform, which is the shape that once made a
 *    dangling key serve one tenant's rows to another (#1397).
 *  - the partner surface is READ-ONLY by decision, not by accident: a partner
 *    must not be able to declare their own payout settled.
 *
 * Each test below is written so that deleting the line it guards makes it fail.
 */
import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"
import { PARTNER_MCP_TOOLS } from "../../../api/partners/mcp/lib/registry"
import { dispatchAdminTool } from "../../../api/admin/mcp/lib/dispatch"
import { dispatchPartnerTool } from "../../../api/partners/mcp/lib/dispatch"
import { selectAdminToolSlice } from "../../../api/admin/mcp/lib/tool-slice"
import { selectPartnerToolSlice } from "../../../api/partners/mcp/lib/tool-slice"
import { isSensitive } from "../schema"

/** Unreachable origin — every assertion here runs on a dry_run or a refusal. */
const CTX = { baseUrl: "http://localhost:9999" }

const adminTool = (name: string) =>
  ADMIN_MCP_TOOLS.find((t) => t.name === name)
const partnerTool = (name: string) =>
  PARTNER_MCP_TOOLS.find((t) => t.name === name)

describe("admin: the partner money reads", () => {
  it.each([
    ["get_partner_ledger", "/admin/payments/partners/:id/ledger"],
    ["list_payable_runs", "/admin/payment-submissions/payable-runs"],
    [
      "list_payable_inventory_orders",
      "/admin/payment-submissions/payable-inventory-orders",
    ],
    ["get_partner_credits", "/admin/partners/:id/credits"],
  ])("%s wraps %s as a plain read", (name, path) => {
    const def = adminTool(name)!
    expect(def).toBeTruthy()
    expect(def.method ?? "GET").toBe("GET")
    expect(def.path).toBe(path)
    expect(def.write).toBeFalsy()
    expect(isSensitive(def)).toBe(false)
  })

  it("the ledger read plans the partner's own ledger path", async () => {
    const res = await dispatchAdminTool(CTX, "get_partner_ledger", {
      id: "partner_1",
      dry_run: true,
    })
    expect(res.ok).toBe(true)
    expect(res.plan?.path).toBe("/admin/payments/partners/partner_1/ledger")
  })

  /**
   * The tenancy property, asserted as a REFUSAL rather than as a schema shape.
   *
   * `partner_id` is required by the route because an unfiltered call returns
   * every completed run on the platform. A tool that advertised it as optional
   * would let the model omit it and get exactly that.
   */
  it.each(["list_payable_runs", "list_payable_inventory_orders"])(
    "%s refuses to run without partner_id instead of asking for everyone's",
    async (name) => {
      const res = await dispatchAdminTool(CTX, name, { dry_run: true })
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/partner_id/)
    }
  )

  it("forwards partner_id as a query param the route will actually read", async () => {
    const res = await dispatchAdminTool(CTX, "list_payable_runs", {
      partner_id: "partner_1",
      dry_run: true,
    })
    expect(res.plan?.query).toEqual({ partner_id: "partner_1" })
    // Nothing silently dropped: a dropped argument is the failure mode this
    // whole surface is exposed to.
    expect(res.plan?.dropped_arguments).toBeUndefined()
  })
})

describe("admin: linking a payment to the payout it settles", () => {
  it("is a guarded write, not an ordinary one — money moves on the ledger", () => {
    const def = adminTool("link_payment_to_payout")!
    expect(def.method).toBe("POST")
    expect(def.path).toBe("/admin/payments/:id/settles")
    expect(def.write).toBe(true)
    expect(isSensitive(def)).toBe(true)
  })

  it("refuses to execute without confirm, and shows the plan it would run", async () => {
    const res = await dispatchAdminTool(CTX, "link_payment_to_payout", {
      id: "pay_1",
      payment_submission_id: "sub_1",
    })
    expect(res.requires_confirmation).toBe(true)
    expect(res.plan?.method).toBe("POST")
    expect(res.plan?.path).toBe("/admin/payments/pay_1/settles")
    /**
     * 🔑 The body is the whole point of the row. `payment_submission_id` is the
     * only field the route's `.strict()` validator accepts, and a version of
     * this tool that failed to forward it would still return a plan, still
     * render a confirmation card, and settle nothing.
     */
    expect(res.plan?.body).toEqual({ payment_submission_id: "sub_1" })
  })

  it("cannot be called without naming the payout — half a link is not a link", async () => {
    const res = await dispatchAdminTool(CTX, "link_payment_to_payout", {
      id: "pay_1",
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/payment_submission_id/)
    expect(res.requires_confirmation).toBeFalsy()
  })

  it("unlink sends payment_submission_id as QUERY, which is where the route reads it first", async () => {
    const def = adminTool("unlink_payment_from_payout")!
    expect(def.method).toBe("DELETE")
    expect(def.write).toBe(true)
    // Every DELETE is implicitly sensitive; this one is undoing a money fact.
    expect(isSensitive(def)).toBe(true)

    const res = await dispatchAdminTool(CTX, "unlink_payment_from_payout", {
      id: "pay_1",
      payment_submission_id: "sub_1",
      dry_run: true,
    })
    expect(res.plan?.path).toBe("/admin/payments/pay_1/settles")
    expect(res.plan?.query).toEqual({ payment_submission_id: "sub_1" })
    expect(res.plan?.body).toBeUndefined()
  })
})

describe("the partner surface stays read-only (founder's decision, #1712)", () => {
  it.each([
    ["list_payable_runs", "/partners/payment-submissions/payable-runs"],
    [
      "list_payable_inventory_orders",
      "/partners/payment-submissions/payable-inventory-orders",
    ],
    ["list_credits", "/partners/credits"],
  ])("%s is a GET with no arguments at all", (name, path) => {
    const def = partnerTool(name)!
    expect(def).toBeTruthy()
    expect(def.method ?? "GET").toBe("GET")
    expect(def.path).toBe(path)
    expect(def.write).toBeFalsy()
    expect(def.pathParams ?? []).toEqual([])
    expect(def.queryParams ?? []).toEqual([])
    expect(def.bodyParams ?? []).toEqual([])
  })

  /**
   * ⚠️ Not merely "takes no partner_id today". A partner-supplied id is how
   * every storefront once rendered every other partner's quote: these routes
   * scope themselves to the authenticated partner, and a tool that offered an
   * id argument would be advertising a parameter the route ignores — or, one
   * route edit later, one it honours.
   */
  it("offers no way to ask about another partner", () => {
    for (const name of [
      "list_payable_runs",
      "list_payable_inventory_orders",
      "list_credits",
    ]) {
      const props = Object.keys(
        partnerTool(name)!.inputSchema?.properties ?? {}
      )
      expect(props).toEqual([])
    }
  })

  it("exposes NO tool that settles a payout or mints a credit", () => {
    const writers = PARTNER_MCP_TOOLS.filter(
      (t) =>
        (t.method ?? "GET") !== "GET" &&
        /\/settles|\/credits/.test(t.path ?? "")
    ).map((t) => t.name)
    expect(writers).toEqual([])
  })

  it("a partner asking about a credit still gets the read", async () => {
    const res = await dispatchPartnerTool(CTX, "list_credits", {
      dry_run: true,
    })
    expect(res.ok).toBe(true)
    expect(res.plan?.method).toBe("GET")
    expect(res.plan?.path).toBe("/partners/credits")
  })
})

/**
 * Slicing. A registered tool the slicer never selects is a tool nobody can
 * reach — the #1612 shape, where `inventory_order_lines` had a validator, a
 * guard, tranche folding and zero rows because no screen offered it.
 */
describe("the ask an operator actually types reaches these tools", () => {
  const sliceFor = (ask: string) =>
    selectAdminToolSlice(ask, ADMIN_MCP_TOOLS).names

  it("'what can I still pay this partner for?' loads both payable reads", () => {
    const names = sliceFor("what can I still pay this partner for?")
    expect(names).toEqual(
      expect.arrayContaining([
        "list_payable_runs",
        "list_payable_inventory_orders",
        "get_partner_ledger",
      ])
    )
  })

  it("'has hrhandloom been paid, and what is outstanding?' loads the ledger", () => {
    expect(sliceFor("has hrhandloom been paid, and what is outstanding?")).toContain(
      "get_partner_ledger"
    )
  })

  it("'does this partner hold any credit from an overpayment?' loads the credits read", () => {
    expect(
      sliceFor("does this partner hold any credit from an overpayment?")
    ).toContain("get_partner_credits")
  })

  it("'record that this payment settles the payout' loads the link tool", () => {
    expect(sliceFor("record that this payment settles the payout")).toContain(
      "link_payment_to_payout"
    )
  })

  it("a partner's own 'am I owed anything?' loads their payable reads", () => {
    const names = selectPartnerToolSlice("am I owed anything?", PARTNER_MCP_TOOLS)
      .names
    expect(names).toEqual(
      expect.arrayContaining([
        "list_payable_runs",
        "list_payable_inventory_orders",
      ])
    )
  })
})
