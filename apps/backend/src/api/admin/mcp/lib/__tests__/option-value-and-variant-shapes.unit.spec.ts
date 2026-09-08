/**
 * Three shapes that only a REAL call against prod revealed (#1907 follow-up).
 *
 * #1906 repointed `update_product_option` at the batch route and shipped with
 * every unit test green — including a new guard proving the route exists. The
 * route did exist. The BODY was still wrong, and no amount of registry
 * introspection could have said so, because a description is prose until
 * something on the other end disagrees with it.
 *
 * Running the two variants owed on `inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF`
 * disagreed three times:
 *
 *  1. `add: ["33s"]` — a bare string in `add` is read as the ID of an
 *     ALREADY-EXISTING option value. Core answered:
 *       "You tried to set relationship product_option_value_id: 33s,
 *        but such entity does not exist"
 *     An error naming a relationship the caller never mentioned, which reads
 *     like a data problem and sends you looking for a missing row. The correct
 *     shape is `add: [{ value: "33s" }]`.
 *
 *  2. `manage_inventory` is `.optional().default(true)` in core. The old
 *     docblock said "leave it off", which was read — by me — as "omit it".
 *     Omitting it turns tracking ON. The 33s variant was created tracked while
 *     all five of its siblings are untracked, and a tracked variant with no
 *     stock is refused at checkout while its siblings sell freely.
 *
 *  3. `prices` is REQUIRED on variant create — `z.array(...)` with no
 *     `.optional()`. A genuinely unpriced variant (the 1 m Linen sample) must
 *     send `[]`. Omitting the key is a 400: "Field 'prices' is required".
 *     There is no `.min(1)`, so `[]` is accepted.
 *
 * These pin the DESCRIPTIONS, because the description is the only thing a model
 * reads before it builds the body. A wrong one is a defect with no stack trace.
 */
import { ADMIN_MCP_TOOLS } from "../registry"

const byName = (n: string) => ADMIN_MCP_TOOLS.find((t) => t.name === n)!

describe("option-value and variant body shapes (#1907 follow-up)", () => {
  describe("update_product_option: `add` takes objects, not strings", () => {
    const def = () => byName("update_product_option")

    it("declares add[] items as objects requiring `value`", () => {
      const add = (def().inputSchema as any).properties.update.items.properties
        .add
      expect(add.items.type).toBe("object")
      expect(add.items.required).toEqual(["value"])
      // The bare-string form is what fails, so it must not be offered.
      expect(add.items.type).not.toBe("string")
    })

    it("says so in the description, where a model actually looks", () => {
      const d = def().description
      expect(d).toMatch(/OBJECTS/)
      expect(d).toContain("{ value: '33s' }")
      // Quote the real error, so the next caller recognises it instantly
      // instead of hunting for a missing option-value row.
      expect(d).toContain("product_option_value_id")
    })

    it("still distinguishes remove, which really does take ids", () => {
      const d = def().description
      expect(d).toMatch(/optval_/)
    })
  })

  describe("create_product_variant: the two defaults that bite", () => {
    const def = () => byName("create_product_variant")

    it("says manage_inventory must be passed explicitly, not omitted", () => {
      const d = def().description
      // "Leave it off" was the old wording and is exactly the misreading:
      // core's default is true, so omission is the opposite of off.
      expect(d).toMatch(/EXPLICITLY/)
      expect(d).toMatch(/defaults it to TRUE/i)
      expect(d).not.toMatch(/Leave `manage_inventory` off/)
    })

    it("explains the consequence, not just the flag", () => {
      // A rule without its consequence gets overridden by a plausible-looking
      // shortcut the next time someone is in a hurry.
      expect(def().description).toMatch(/refused at checkout/i)
    })

    it("says prices is required, and that [] is the way to send none", () => {
      const prices = (def().inputSchema as any).properties.prices
      expect(prices.description).toMatch(/REQUIRED/)
      expect(prices.description).toMatch(/\[\]/)
      expect(prices.description).toContain("Field 'prices' is required")
    })

    it("keeps prices forwarded — an unsent [] is not the same as an empty one", () => {
      expect(def().bodyParams).toContain("prices")
      expect(def().bodyParams).toContain("manage_inventory")
    })
  })
})
