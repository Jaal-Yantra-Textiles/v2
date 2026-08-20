import { derivePostCreateFacts } from "../create-partner-product"

/**
 * #1380 / #1370 — the inventory-level branch gate.
 *
 * `hasManagedVariants` decides whether a partner product create pays for
 * `ensureInventoryLevelsForVariants`, measured at 4 091 ms and 7 999 ms on prod
 * for payloads that turned out to need none of it. Both directions matter:
 * a false negative silently stops seeding stock levels (the partner-ui
 * inventory page then 404s on the item), a false positive puts the cost back.
 */
describe("derivePostCreateFacts", () => {
  const variant = (over: Record<string, any> = {}) => ({
    id: "variant_1",
    manage_inventory: false,
    ...over,
  })

  it("skips the inventory branch when no variant manages inventory", () => {
    const facts = derivePostCreateFacts([
      { id: "prod_1", variants: [variant({ id: "v1" }), variant({ id: "v2" })] },
    ])

    expect(facts).toEqual({
      productId: "prod_1",
      variantIds: ["v1", "v2"],
      hasManagedVariants: false,
    })
  })

  it("takes the inventory branch when any single variant manages inventory", () => {
    const facts = derivePostCreateFacts([
      {
        id: "prod_1",
        variants: [variant({ id: "v1" }), variant({ id: "v2", manage_inventory: true })],
      },
    ])

    expect(facts.hasManagedVariants).toBe(true)
    expect(facts.variantIds).toEqual(["v1", "v2"])
  })

  it("treats a missing manage_inventory as unmanaged, not managed", () => {
    const facts = derivePostCreateFacts([
      { id: "prod_1", variants: [{ id: "v1" }] },
    ])

    expect(facts.hasManagedVariants).toBe(false)
  })

  it("does not treat a truthy non-boolean as managed", () => {
    const facts = derivePostCreateFacts([
      { id: "prod_1", variants: [{ id: "v1", manage_inventory: "false" }] },
    ])

    expect(facts.hasManagedVariants).toBe(false)
  })

  it("survives a product with no variants — every branch is skippable", () => {
    const facts = derivePostCreateFacts([{ id: "prod_1" }])

    expect(facts).toEqual({
      productId: "prod_1",
      variantIds: [],
      hasManagedVariants: false,
    })
  })

  it("drops variants with no id rather than emitting undefined ids", () => {
    const facts = derivePostCreateFacts([
      { id: "prod_1", variants: [{ manage_inventory: true }, variant({ id: "v2" })] },
    ])

    expect(facts.variantIds).toEqual(["v2"])
  })

  it("returns a null productId for an empty create result", () => {
    expect(derivePostCreateFacts([])).toEqual({
      productId: null,
      variantIds: [],
      hasManagedVariants: false,
    })
    expect(derivePostCreateFacts(undefined).productId).toBeNull()
  })
})
