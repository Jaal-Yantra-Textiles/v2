import {
  buildProductProvenance,
  recordProductProvenance,
  type ProductProvenanceInput,
} from "../lib/provenance"

/**
 * An admin can now create a product straight into a partner's store, where it
 * goes live on their public storefront. The thing that must not happen is a
 * product appearing in someone's shop that they did not make, with no record of
 * who put it there — so these cases pin the two properties that decide whether
 * that record can be trusted: `created_on_behalf` is DERIVED rather than
 * accepted from the caller, and the announcement fires for exactly the case
 * that warrants it.
 */

const input = (over: Partial<ProductProvenanceInput> = {}): ProductProvenanceInput => ({
  owner_partner_id: "partner_owner",
  product_id: "prod_1",
  store_id: "store_1",
  actor_type: "admin",
  actor_id: "user_admin",
  source: "admin_store_products",
  ...over,
})

describe("buildProductProvenance", () => {
  it("marks an admin create as on-behalf", () => {
    expect(buildProductProvenance(input())).toEqual({
      created_by_actor_type: "admin",
      created_by_actor_id: "user_admin",
      created_on_behalf: true,
      store_id: "store_1",
      source: "admin_store_products",
    })
  })

  it("does NOT mark a partner creating in their own store as on-behalf", () => {
    const p = buildProductProvenance(
      input({
        actor_type: "partner",
        actor_partner_id: "partner_owner",
        actor_id: "padm_1",
      })
    )
    expect(p.created_on_behalf).toBe(false)
  })

  it("marks a partner creating in ANOTHER partner's store as on-behalf", () => {
    // A partner can serve another partner's store — see links/partner-order.ts.
    const p = buildProductProvenance(
      input({ actor_type: "partner", actor_partner_id: "partner_other" })
    )
    expect(p.created_on_behalf).toBe(true)
  })

  it("treats an UNKNOWN acting partner as on-behalf, not as the owner", () => {
    // The unsafe default would be to assume the actor is the owner and record
    // false — that is the value that makes an unattributed create look normal.
    const p = buildProductProvenance(input({ actor_type: "partner" }))
    expect(p.created_on_behalf).toBe(true)
  })

  it("cannot be told what to record — on_behalf is derived, not passed", () => {
    const sneaky = { ...input(), created_on_behalf: false } as any
    expect(buildProductProvenance(sneaky).created_on_behalf).toBe(true)
  })

  it("keeps a missing actor id as null rather than inventing one", () => {
    expect(buildProductProvenance(input({ actor_id: null }))).toMatchObject({
      created_by_actor_id: null,
    })
  })
})

describe("recordProductProvenance", () => {
  const scopeWith = (over: { link?: any; bus?: any; log?: any } = {}) => {
    const link = over.link ?? { create: jest.fn().mockResolvedValue(undefined) }
    const bus = over.bus ?? { emit: jest.fn().mockResolvedValue(undefined) }
    const log = over.log ?? { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
    const scope = {
      resolve: jest.fn((key: string) => {
        if (key === "link") return link
        if (key === "event_bus") return bus
        if (key === "logger") return log
        return undefined
      }),
    }
    return { scope, link, bus, log }
  }

  it("writes the provenance columns onto the ownership link", async () => {
    const { scope, link } = scopeWith()

    await recordProductProvenance(scope, input())

    const payload = link.create.mock.calls[0][0]
    expect(payload.data).toMatchObject({
      created_by_actor_type: "admin",
      created_on_behalf: true,
      store_id: "store_1",
      source: "admin_store_products",
    })
    expect(payload.partner).toEqual({ partner_id: "partner_owner" })
  })

  it("announces an on-behalf create so the partner can be told", async () => {
    const { scope, bus } = scopeWith()

    const out = await recordProductProvenance(scope, input())

    expect(out).toEqual({ linked: true, announced: true })
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "product.created_for_partner" })
    )
  })

  it("stays quiet when a partner creates their own product", async () => {
    const { scope, bus } = scopeWith()

    const out = await recordProductProvenance(
      scope,
      input({ actor_type: "partner", actor_partner_id: "partner_owner" })
    )

    expect(bus.emit).not.toHaveBeenCalled()
    expect(out.announced).toBe(false)
  })

  describe("a failed audit is reported, never swallowed", () => {
    it("does not throw when the link write fails — the product already exists", async () => {
      const { scope, log } = scopeWith({
        link: { create: jest.fn().mockRejectedValue(new Error("link down")) },
      })

      const out = await recordProductProvenance(scope, input())

      expect(out.linked).toBe(false)
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("link down"))
    })

    it("still announces even if the link write failed", async () => {
      // The partner learning about it does not depend on our bookkeeping.
      const { scope, bus } = scopeWith({
        link: { create: jest.fn().mockRejectedValue(new Error("nope")) },
      })

      const out = await recordProductProvenance(scope, input())

      expect(bus.emit).toHaveBeenCalled()
      expect(out).toEqual({ linked: false, announced: true })
    })

    it("does not throw when the announcement fails, and says so", async () => {
      const { scope, log } = scopeWith({
        bus: { emit: jest.fn().mockRejectedValue(new Error("bus down")) },
      })

      const out = await recordProductProvenance(scope, input())

      expect(out).toEqual({ linked: true, announced: false })
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("bus down"))
    })
  })
})
