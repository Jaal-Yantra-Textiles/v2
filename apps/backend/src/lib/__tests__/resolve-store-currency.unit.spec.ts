import {
  pickDefaultCurrency,
  pickStoreForSalesChannels,
  pickStorefrontCurrency,
  resolveStoreCurrency,
  resolveStorefrontCurrency,
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

/**
 * Storefront (publishable-key) currency resolution.
 *
 * The design estimate/checkout routes used `entity: "store", filters: {}` → `[0]`
 * with divergent literal fallbacks ("eur" on one, "inr" on the other). Prod runs
 * 14 stores whose row 0 is the platform store (EUR) while 11 storefronts are
 * INR, so a storefront's INR-derived estimate was labelled EUR and then
 * converted EUR→INR at the till. These cover the replacement.
 */
describe("storefront currency resolution", () => {
  // Shaped like the prod table: one platform store (EUR) first, partner
  // storefronts after — so a regression to `stores[0]` returns "eur" and is
  // visible in every assertion below.
  const PLATFORM = {
    id: "store_platform",
    default_sales_channel_id: "sc_platform",
    supported_currencies: [
      { currency_code: "usd", is_default: false },
      { currency_code: "eur", is_default: true },
    ],
  }
  const SHARLHO = {
    id: "store_sharlho",
    default_sales_channel_id: "sc_sharlho",
    supported_currencies: [
      { currency_code: "eur", is_default: false },
      { currency_code: "inr", is_default: true },
    ],
  }
  const WOVEN = {
    id: "store_woven",
    default_sales_channel_id: "sc_woven",
    supported_currencies: [{ currency_code: "aud", is_default: true }],
  }
  const ALL = [PLATFORM, SHARLHO, WOVEN]

  describe("pickStorefrontCurrency", () => {
    it("returns the is_default currency, lower-cased", () => {
      expect(
        pickStorefrontCurrency({
          supported_currencies: [
            { currency_code: "usd", is_default: false },
            { currency_code: "INR", is_default: true },
          ],
        })
      ).toBe("inr")
    })

    it("returns null — not a fallback — when no currency is flagged default", () => {
      expect(
        pickStorefrontCurrency({ supported_currencies: [{ currency_code: "usd" }] })
      ).toBeNull()
      expect(pickStorefrontCurrency({ supported_currencies: [] })).toBeNull()
      expect(pickStorefrontCurrency({})).toBeNull()
      expect(pickStorefrontCurrency(null)).toBeNull()
    })

    // `''` survives a `??` guard. A price denominated in "" is not a price.
    it("treats a blank currency code as absent", () => {
      expect(
        pickStorefrontCurrency({
          supported_currencies: [{ currency_code: "   ", is_default: true }],
        })
      ).toBeNull()
      expect(
        pickStorefrontCurrency({
          supported_currencies: [{ currency_code: "", is_default: true }],
        })
      ).toBeNull()
    })
  })

  describe("pickStoreForSalesChannels", () => {
    it("picks the store whose DEFAULT channel the key grants — not row 0", () => {
      expect(pickStoreForSalesChannels(ALL, ["sc_sharlho"])?.id).toBe("store_sharlho")
      expect(pickStoreForSalesChannels(ALL, ["sc_woven"])?.id).toBe("store_woven")
      expect(pickStoreForSalesChannels(ALL, ["sc_platform"])?.id).toBe("store_platform")
    })

    it("returns null when the key grants no channel", () => {
      expect(pickStoreForSalesChannels(ALL, [])).toBeNull()
      expect(pickStoreForSalesChannels(ALL, null)).toBeNull()
      expect(pickStoreForSalesChannels(ALL, [""])).toBeNull()
    })

    it("returns null when no store claims the granted channel", () => {
      expect(pickStoreForSalesChannels(ALL, ["sc_orphan"])).toBeNull()
      expect(pickStoreForSalesChannels([], ["sc_sharlho"])).toBeNull()
      expect(pickStoreForSalesChannels(null, ["sc_sharlho"])).toBeNull()
    })

    // Ambiguity is a data fault. Answering it with [0] is the selector bug.
    it("refuses rather than guessing when two stores share a default channel", () => {
      const clash = [
        { ...PLATFORM, default_sales_channel_id: "sc_dupe" },
        { ...SHARLHO, default_sales_channel_id: "sc_dupe" },
      ]
      expect(pickStoreForSalesChannels(clash, ["sc_dupe"])).toBeNull()
    })

    // A store with a null default channel must never match a key that grants
    // nothing meaningful — `undefined === undefined` would pair them up.
    it("ignores stores with no default sales channel", () => {
      const orphan = [{ id: "store_x", supported_currencies: [] }]
      expect(pickStoreForSalesChannels(orphan, ["sc_sharlho"])).toBeNull()
    })
  })

  describe("resolveStorefrontCurrency", () => {
    // The graph call must actually FILTER. A container that ignores `filters`
    // and returns the whole table would still pass if the resolver leaned on
    // row order; pickStoreForSalesChannels is what makes it correct.
    const makeContainer = (rows: any[], onArgs?: (a: any) => void) => ({
      resolve: () => ({
        graph: async (args: any) => {
          onArgs?.(args)
          return { data: rows }
        },
      }),
    })

    it("resolves the requesting storefront's currency, not the platform's", async () => {
      await expect(
        resolveStorefrontCurrency(makeContainer(ALL), {
          sales_channel_ids: ["sc_sharlho"],
        })
      ).resolves.toBe("inr")

      await expect(
        resolveStorefrontCurrency(makeContainer(ALL), {
          sales_channel_ids: ["sc_woven"],
        })
      ).resolves.toBe("aud")
    })

    it("expands supported_currencies and filters by default_sales_channel_id", async () => {
      let seen: any
      await resolveStorefrontCurrency(
        makeContainer([SHARLHO], (a) => (seen = a)),
        { sales_channel_ids: ["sc_sharlho"] }
      )
      // `fields: ["*"]` does NOT expand a hasMany; the default flag would be
      // missing and every store would resolve to null.
      expect(seen.fields).toEqual(
        expect.arrayContaining([
          "supported_currencies.currency_code",
          "supported_currencies.is_default",
        ])
      )
      expect(seen.filters).toEqual({ default_sales_channel_id: ["sc_sharlho"] })
    })

    it("returns null when the key grants no sales channel", async () => {
      await expect(
        resolveStorefrontCurrency(makeContainer(ALL), { sales_channel_ids: [] })
      ).resolves.toBeNull()
      await expect(
        resolveStorefrontCurrency(makeContainer(ALL), null)
      ).resolves.toBeNull()
      await expect(
        resolveStorefrontCurrency(makeContainer(ALL), undefined)
      ).resolves.toBeNull()
    })

    it("returns null — never a currency — when the query throws", async () => {
      const container = {
        resolve: () => ({
          graph: async () => {
            throw new Error("boom")
          },
        }),
      }
      await expect(
        resolveStorefrontCurrency(container, { sales_channel_ids: ["sc_sharlho"] })
      ).resolves.toBeNull()
    })

    it("returns null when the resolved store names no default currency", async () => {
      const noDefault = [
        {
          id: "store_y",
          default_sales_channel_id: "sc_y",
          supported_currencies: [{ currency_code: "inr", is_default: false }],
        },
      ]
      await expect(
        resolveStorefrontCurrency(makeContainer(noDefault), {
          sales_channel_ids: ["sc_y"],
        })
      ).resolves.toBeNull()
    })
  })
})
