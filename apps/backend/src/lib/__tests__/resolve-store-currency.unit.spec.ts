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

    // #485 forward-fix: pickDefaultCurrency replaced 3 hand-rolled is_default
    // scans (create-draft-order-from-designs, dual-write-unified-order,
    // dual-write-unified-run-order). Prove it reproduces the old inline
    // expression byte-for-byte across the representative store shapes so the
    // centralisation is behaviour-preserving.
    describe("parity with the replaced inline is_default scans", () => {
      // The exact expression that lived at every call site (mod lower-casing,
      // which the replaced design site already did and is a no-op for the
      // canonical lower-case currency codes stored by Medusa).
      const inline = (store: any, fallback = "inr") =>
        (store?.supported_currencies?.find((c: any) => c?.is_default)
          ?.currency_code ?? fallback)

      const shapes = [
        { supported_currencies: [{ currency_code: "eur", is_default: true }] },
        { supported_currencies: [
          { currency_code: "usd", is_default: false },
          { currency_code: "inr", is_default: true },
        ] },
        { supported_currencies: [{ currency_code: "usd", is_default: false }] }, // no default → fallback
        { supported_currencies: [] },
        {},
        null,
      ]

      it.each(shapes)("matches inline scan for %j", (store) => {
        expect(pickDefaultCurrency(store, "inr")).toBe(
          String(inline(store, "inr")).toLowerCase()
        )
      })
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
