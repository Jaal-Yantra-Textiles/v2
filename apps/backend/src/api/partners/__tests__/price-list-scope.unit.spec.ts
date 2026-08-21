import { validatePriceListRules } from "../price-lists/helpers"
import { validatePartnerOwnsEntities } from "../helpers"

jest.mock("../helpers", () => ({
  validatePartnerOwnsEntities: jest.fn(),
}))

/**
 * Partner scoping for price lists (#1405).
 *
 * A price list carries money, and `rules.customer_group_id` is the field that
 * decides WHOSE money. Owning the list says nothing about owning the group it
 * is scoped to — the same "validate both ends" rule that #1404 established for
 * customer groups, applied to the surface that actually prices a cart.
 */

const mocked = validatePartnerOwnsEntities as jest.MockedFunction<
  typeof validatePartnerOwnsEntities
>

const auth = { actor_id: "partner_mine" }
const container = {} as any

beforeEach(() => {
  mocked.mockReset()
  mocked.mockResolvedValue({ partner: {}, store: {} } as any)
})

describe("validatePriceListRules", () => {
  it("asserts ownership of every customer group named in the rules", async () => {
    await validatePriceListRules(
      auth,
      { customer_group_id: ["cg_mine", "cg_also_mine"] },
      container
    )

    expect(mocked).toHaveBeenCalledWith(
      auth,
      "customer_groups",
      ["cg_mine", "cg_also_mine"],
      container
    )
  })

  it("propagates the NOT_FOUND when a group belongs to another partner", async () => {
    mocked.mockRejectedValue(new Error("customer groups not found: cg_theirs"))

    await expect(
      validatePriceListRules(auth, { customer_group_id: ["cg_theirs"] }, container)
    ).rejects.toThrow("cg_theirs")
  })

  it("checks EVERY id, not just the first — a valid id must not smuggle in a foreign one", async () => {
    await validatePriceListRules(
      auth,
      { customer_group_id: ["cg_mine", "cg_theirs"] },
      container
    )

    expect(mocked.mock.calls[0][2]).toEqual(["cg_mine", "cg_theirs"])
  })

  it("skips the check when no customer group rule is present", async () => {
    // region_id and currency_code are platform-wide by design — there is no
    // partner dimension to assert, and calling the guard would 404 nothing.
    await validatePriceListRules(auth, { region_id: ["reg_1"] }, container)

    expect(mocked).not.toHaveBeenCalled()
  })

  it("skips the check for an absent, null or empty rule set", async () => {
    await validatePriceListRules(auth, undefined, container)
    await validatePriceListRules(auth, null, container)
    await validatePriceListRules(auth, { customer_group_id: [] }, container)

    expect(mocked).not.toHaveBeenCalled()
  })
})
