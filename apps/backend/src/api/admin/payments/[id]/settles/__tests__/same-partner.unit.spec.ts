import {
  decideSamePartner,
  resolvePaymentOwners,
} from "../same-partner"

describe("decideSamePartner (#1712)", () => {
  it("refuses a payment demonstrably owned by another partner", () => {
    const d = decideSamePartner(["partner_A"], "partner_B")
    expect(d.allowed).toBe(false)
    expect(d.owners).toEqual(["partner_A"])
  })

  it("allows when the owner matches", () => {
    expect(decideSamePartner(["partner_A"], "partner_A").allowed).toBe(true)
  })

  /**
   * A payment can be reached through more than one home, and the homes can
   * legitimately disagree in COUNT while agreeing that this partner is one of
   * the owners.
   */
  it("allows when the submission's partner is one of several owners", () => {
    expect(
      decideSamePartner(["partner_A", "partner_B"], "partner_B").allowed
    ).toBe(true)
  })

  /**
   * 🔑 The deliberate hole. Historical rows carry no owner at all and are the
   * ones reconciliation needs to link; refusing them would block the work.
   */
  it("allows an unattributable payment", () => {
    expect(decideSamePartner([], "partner_B").allowed).toBe(true)
    expect(decideSamePartner([null, undefined, ""], "partner_B").allowed).toBe(
      true
    )
  })

  it("allows when the submission has no partner to compare against", () => {
    expect(decideSamePartner(["partner_A"], null).allowed).toBe(true)
    expect(decideSamePartner(["partner_A"], "").allowed).toBe(true)
  })

  it("dedupes owners reported by several homes", () => {
    expect(decideSamePartner(["p", "p", "p"], "q").owners).toEqual(["p"])
  })
})

const LINKS = {
  partnerPayments: { entryPoint: "partner_payments" },
  orderPayments: { entryPoint: "order_payments" },
  partnerOrders: { entryPoint: "partner_orders" },
  partnerMethods: { entryPoint: "partner_methods" },
}

describe("resolvePaymentOwners — the three homes (#1712)", () => {
  it("reads the PARTNER link", async () => {
    const graph = jest.fn(async ({ entity }: any) =>
      entity === "partner_payments"
        ? { data: [{ partner_id: "partner_A" }] }
        : { data: [] }
    )
    expect(await resolvePaymentOwners({ graph }, LINKS, "pay_1")).toEqual([
      "partner_A",
    ])
  })

  /**
   * 🔴 Asserted OUTSIDE the mock, deliberately. Each home is wrapped in a
   * best-effort `catch {}`, which swallows a failing `expect()` raised inside
   * the mock and turns the test into a vacuous pass — verified by mutation:
   * renaming the filter key to `internal_payment_id` kept the suite green.
   *
   * The link entry-point convention `<module_model>_id` is not type-checked, so
   * a wrong name returns no rows, no error, and a guard that never fires.
   */
  it("filters each home by the exact link entry-point field name", async () => {
    const graph = jest.fn(async ({ entity }: any) => {
      if (entity === "order_payments")
        return { data: [{ inventory_orders_id: "inv_order_1" }] }
      return { data: [] }
    })
    await resolvePaymentOwners({ graph }, LINKS, "pay_1", "method_1")

    const byEntity = Object.fromEntries(
      graph.mock.calls.map((c: any) => [c[0].entity, c[0]])
    )
    expect(byEntity["partner_payments"].filters).toEqual({
      internal_payments_id: "pay_1",
    })
    expect(byEntity["order_payments"].filters).toEqual({
      internal_payments_id: "pay_1",
    })
    expect(byEntity["partner_orders"].filters).toEqual({
      inventory_orders_id: ["inv_order_1"],
    })
    expect(byEntity["partner_methods"].filters).toEqual({
      internal_payment_details_id: "method_1",
    })
    for (const call of graph.mock.calls) {
      expect(call[0].fields).toBeDefined()
    }
  })

  /**
   * 🔴 `submit-payment` writes ONLY the order link, so Parmar's two INR 10,000
   * rows are reachable through nothing else. Two hops: payment → order →
   * partner.
   */
  it("reads the INVENTORY ORDER link, then that order's partner", async () => {
    const query = {
      graph: jest.fn(async ({ entity, filters }: any) => {
        if (entity === "order_payments") {
          return { data: [{ inventory_orders_id: "inv_order_1" }] }
        }
        if (entity === "partner_orders") {
          return { data: [{ partner_id: "partner_B" }] }
        }
        return { data: [] }
      }),
    }
    expect(await resolvePaymentOwners(query, LINKS, "pay_2")).toEqual([
      "partner_B",
    ])
  })

  /** On production this is the ONLY home for 6 of 35 payments. */
  it("reads the paid_to METHOD link", async () => {
    const query = {
      graph: jest.fn(async ({ entity, filters }: any) => {
        if (entity === "partner_methods") {
          return { data: [{ partner_id: "partner_C" }] }
        }
        return { data: [] }
      }),
    }
    expect(await resolvePaymentOwners(query, LINKS, "pay_3", "method_1")).toEqual(
      ["partner_C"]
    )
  })

  it("skips the method home when the payment has no paid_to", async () => {
    const graph = jest.fn(async () => ({ data: [] }))
    await resolvePaymentOwners({ graph }, LINKS, "pay_4", null)
    const entities = graph.mock.calls.map((c: any) => c[0].entity)
    expect(entities).not.toContain("partner_methods")
  })

  /**
   * ⚠️ Best-effort per home: an understated owner set is permissive, never a
   * false refusal. One throwing home must not lose the others.
   */
  it("survives a throwing home and still reports the others", async () => {
    const query = {
      graph: jest.fn(async ({ entity }: any) => {
        if (entity === "partner_payments") throw new Error("graph hiccup")
        if (entity === "partner_methods")
          return { data: [{ partner_id: "partner_D" }] }
        return { data: [] }
      }),
    }
    expect(await resolvePaymentOwners(query, LINKS, "pay_5", "m")).toEqual([
      "partner_D",
    ])
  })

  it("unions and dedupes across homes", async () => {
    const query = {
      graph: jest.fn(async ({ entity }: any) => {
        if (entity === "partner_payments")
          return { data: [{ partner_id: "partner_A" }] }
        if (entity === "partner_methods")
          return { data: [{ partner_id: "partner_A" }] }
        return { data: [] }
      }),
    }
    expect(await resolvePaymentOwners(query, LINKS, "pay_6", "m")).toEqual([
      "partner_A",
    ])
  })
})
