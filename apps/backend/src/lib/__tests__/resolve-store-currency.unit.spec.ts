import {
  pickDefaultCurrency,
  resolveStoreCurrency,
} from "../resolve-store-currency"

// Pure / container-mocked unit coverage for the #485 currency resolver. No DB —
// a fake container whose query.graph returns canned rows per entity.
describe("resolve-store-currency (#485)", () => {
  describe("pickDefaultCurrency", () => {
    it("returns the is_default currency, lower-cased", () => {
      expect(
        pickDefaultCurrency({
          supported_currencies: [
            { currency_code: "USD", is_default: false },
            { currency_code: "INR", is_default: true },
          ],
        })
      ).toBe("inr")
    })

    it("falls back to 'inr' when no default flagged", () => {
      expect(
        pickDefaultCurrency({ supported_currencies: [{ currency_code: "usd" }] })
      ).toBe("inr")
    })

    it("falls back when store/currencies missing", () => {
      expect(pickDefaultCurrency(null)).toBe("inr")
      expect(pickDefaultCurrency({})).toBe("inr")
      expect(pickDefaultCurrency(undefined, "usd")).toBe("usd")
    })
  })

  describe("resolveStoreCurrency", () => {
    const makeContainer = (graph: (args: any) => any) => ({
      resolve: () => ({ graph: async (args: any) => graph(args) }),
    })

    it("resolves the partner store currency when partnerId is given", async () => {
      const container = makeContainer((args) => {
        if (args.entity === "partners") {
          return {
            data: [
              {
                id: "p_1",
                stores: [
                  {
                    supported_currencies: [
                      { currency_code: "eur", is_default: false },
                      { currency_code: "inr", is_default: true },
                    ],
                  },
                ],
              },
            ],
          }
        }
        // platform store (would be EUR) — must NOT be used here
        return { data: [{ supported_currencies: [{ currency_code: "eur", is_default: true }] }] }
      })

      await expect(
        resolveStoreCurrency(container, { partnerId: "p_1" })
      ).resolves.toBe("inr")
    })

    it("falls back to the platform/base store when the partner has no store", async () => {
      const container = makeContainer((args) => {
        if (args.entity === "partners") return { data: [{ id: "p_1", stores: [] }] }
        return { data: [{ supported_currencies: [{ currency_code: "eur", is_default: true }] }] }
      })

      await expect(
        resolveStoreCurrency(container, { partnerId: "p_1" })
      ).resolves.toBe("eur")
    })

    it("resolves the platform/base store when no partnerId is given", async () => {
      const container = makeContainer((args) => {
        if (args.entity === "store") {
          return { data: [{ supported_currencies: [{ currency_code: "eur", is_default: true }] }] }
        }
        return { data: [] }
      })

      await expect(resolveStoreCurrency(container)).resolves.toBe("eur")
    })

    it("returns the fallback when nothing resolves", async () => {
      const container = makeContainer(() => {
        throw new Error("boom")
      })
      await expect(
        resolveStoreCurrency(container, { fallback: "usd" })
      ).resolves.toBe("usd")
    })
  })
})
