/**
 * Unit tests for the visual-flows `resolve_cart_recovery_urls` operation (#449).
 *
 * The regression this guards: the "Cart Recovery — Hourly Discoverer" flow
 * built every recovery link from a single global `STORE_URL`, so a cart on
 * partner A's sales channel got a checkout link on the root/another store. This
 * op resolves each cart's owning partner storefront from its `sales_channel_id`
 * and falls back to the configured base when a cart isn't tied to a partner —
 * so it's never worse than the old behaviour.
 *
 * The operation only reads `context.container` (the QUERY service) +
 * `context.dataChain`, so we can invoke it directly without booting Medusa.
 */

import {
  resolveCartRecoveryUrlsOperation,
  buildRecoveryUrls,
  summarizeRecoveryUrlRun,
  type EnrichedCart,
} from "../resolve-cart-recovery-urls"

/**
 * Fake QUERY whose `graph` mirrors the two hops in
 * resolvePartnerStorefrontForSalesChannel: stores filtered by
 * default_sales_channel_id, then all partners (matched in JS by the resolver).
 */
function makeQuery(opts: {
  stores: Array<{ id: string; default_sales_channel_id: string }>
  partners: Array<{
    id: string
    name?: string | null
    handle?: string | null
    storefront_domain?: string | null
    metadata?: Record<string, any> | null
    stores: Array<{ id: string }>
  }>
}): any {
  return {
    graph: async ({ entity, filters }: any) => {
      if (entity === "stores") {
        const wanted: string[] = filters?.default_sales_channel_id ?? []
        return {
          data: opts.stores.filter((s) =>
            wanted.includes(s.default_sales_channel_id)
          ),
        }
      }
      if (entity === "partners") {
        return { data: opts.partners }
      }
      return { data: [] }
    },
  }
}

function makeContext(dataChain: Record<string, any>, query: any): any {
  return {
    container: {
      resolve: (name: string) => (name === "query" ? query : null),
    } as any,
    dataChain: {
      $trigger: { payload: {}, timestamp: "2026-06-17T00:00:00.000Z" },
      $accountability: {},
      $env: {},
      $last: null,
      ...dataChain,
    },
    flowId: "flow_test",
    executionId: "exec_test",
    operationId: "op_test",
    operationKey: "resolve_urls",
  }
}

describe("buildRecoveryUrls (pure)", () => {
  it("substitutes {id} and trims trailing slashes on the base", () => {
    expect(buildRecoveryUrls("https://acme.com/", "cart_1")).toEqual({
      cart_url: "https://acme.com/checkout/cart/cart_1",
      unsubscribe_url: "https://acme.com/unsubscribe?cart_id=cart_1",
    })
  })

  it("honours custom path templates", () => {
    expect(
      buildRecoveryUrls("https://x.io", "c9", {
        cartPath: "/recover/{id}",
        unsubscribePath: "/stop/{id}",
      })
    ).toEqual({
      cart_url: "https://x.io/recover/c9",
      unsubscribe_url: "https://x.io/stop/c9",
    })
  })

  it("tolerates an empty base", () => {
    const { cart_url } = buildRecoveryUrls("", "c1")
    expect(cart_url).toBe("/checkout/cart/c1")
  })
})

describe("summarizeRecoveryUrlRun (pure)", () => {
  it("counts resolved vs fallback carts", () => {
    const enriched = [
      { partner_storefront_resolved: true },
      { partner_storefront_resolved: false },
      { partner_storefront_resolved: true },
    ] as EnrichedCart[]
    expect(summarizeRecoveryUrlRun(enriched)).toEqual({
      count: 3,
      with_partner_storefront: 2,
      fallback_count: 1,
    })
  })
})

describe("resolve_cart_recovery_urls operation", () => {
  const QUERY = makeQuery({
    stores: [{ id: "store_A", default_sales_channel_id: "sc_A" }],
    partners: [
      {
        id: "partner_A",
        name: "Acme",
        handle: "acme",
        storefront_domain: "acme.cicilabel.com",
        metadata: { custom_domain: "shop.acme.com" },
        stores: [{ id: "store_A" }],
      },
    ],
  })

  it("points each cart at its owning partner storefront (custom_domain wins)", async () => {
    const result = await resolveCartRecoveryUrlsOperation.execute(
      { carts: "{{ discoverer.carts }}", fallback_base: "https://cicilabel.com" },
      makeContext(
        { discoverer: { carts: [{ id: "cart_1", sales_channel_id: "sc_A" }] } },
        QUERY
      )
    )

    expect(result.success).toBe(true)
    const cart = result.data.carts[0]
    expect(cart.cart_url).toBe("https://shop.acme.com/checkout/cart/cart_1")
    expect(cart.unsubscribe_url).toBe(
      "https://shop.acme.com/unsubscribe?cart_id=cart_1"
    )
    expect(cart.partner_id).toBe("partner_A")
    expect(cart.partner_storefront_resolved).toBe(true)
    expect(result.data.with_partner_storefront).toBe(1)
    expect(result.data.fallback_count).toBe(0)
  })

  it("falls back to the configured base when a cart has no partner storefront", async () => {
    const result = await resolveCartRecoveryUrlsOperation.execute(
      { carts: "{{ discoverer.carts }}", fallback_base: "https://cicilabel.com" },
      makeContext(
        { discoverer: { carts: [{ id: "cart_x", sales_channel_id: "sc_UNKNOWN" }] } },
        QUERY
      )
    )

    expect(result.success).toBe(true)
    const cart = result.data.carts[0]
    expect(cart.cart_url).toBe("https://cicilabel.com/checkout/cart/cart_x")
    expect(cart.partner_id).toBeNull()
    expect(cart.partner_storefront_resolved).toBe(false)
    expect(result.data.fallback_count).toBe(1)
  })

  it("falls back when a cart carries no sales_channel_id at all", async () => {
    const result = await resolveCartRecoveryUrlsOperation.execute(
      { carts: "{{ discoverer.carts }}", fallback_base: "https://fallback.io" },
      makeContext(
        { discoverer: { carts: [{ id: "cart_n" }] } },
        QUERY
      )
    )
    const cart = result.data.carts[0]
    expect(cart.storefront_base).toBe("https://fallback.io")
    expect(cart.cart_url).toBe("https://fallback.io/checkout/cart/cart_n")
    expect(cart.partner_storefront_resolved).toBe(false)
  })

  it("resolves each sales channel at most once across many carts (cache)", async () => {
    const graph = jest.fn(async ({ entity, filters }: any) => {
      if (entity === "stores") {
        const wanted: string[] = filters?.default_sales_channel_id ?? []
        return {
          data: [{ id: "store_A", default_sales_channel_id: "sc_A" }].filter(
            (s) => wanted.includes(s.default_sales_channel_id)
          ),
        }
      }
      if (entity === "partners") {
        return {
          data: [
            {
              id: "partner_A",
              storefront_domain: "acme.cicilabel.com",
              metadata: {},
              stores: [{ id: "store_A" }],
            },
          ],
        }
      }
      return { data: [] }
    })

    const result = await resolveCartRecoveryUrlsOperation.execute(
      { carts: "{{ discoverer.carts }}" },
      makeContext(
        {
          discoverer: {
            carts: [
              { id: "c1", sales_channel_id: "sc_A" },
              { id: "c2", sales_channel_id: "sc_A" },
              { id: "c3", sales_channel_id: "sc_A" },
            ],
          },
        },
        { graph }
      )
    )

    expect(result.success).toBe(true)
    expect(result.data.count).toBe(3)
    expect(result.data.resolved_channels).toBe(1)
    // 3 carts, 1 unique channel → 2 graph calls (stores + partners), not 6.
    expect(graph).toHaveBeenCalledTimes(2)
    // storefront_domain base (no custom/website domain) → normalized https.
    expect(result.data.carts[0].cart_url).toBe(
      "https://acme.cicilabel.com/checkout/cart/c1"
    )
  })

  it("returns an empty result when `carts` resolves to a non-array", async () => {
    const result = await resolveCartRecoveryUrlsOperation.execute(
      { carts: "{{ discoverer.nope }}" },
      makeContext({ discoverer: {} }, QUERY)
    )
    expect(result.success).toBe(true)
    expect(result.data.count).toBe(0)
    expect(result.data.carts).toEqual([])
  })
})
