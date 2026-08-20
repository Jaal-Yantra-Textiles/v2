import { hostToCandidates, resolveStorefrontForPartner } from "../resolve-key"

/**
 * The multi-tenant host → publishable-key walk, and the cross-tenant outage it
 * caused on 2026-08-21.
 *
 * `resolveStorefrontForPartner` queries EVERY publishable key on the platform
 * unfiltered, then `.find`s the one linked to this partner's sales channel.
 * That makes the query a shared blast radius: the predicate runs against other
 * tenants' rows on the way to this tenant's.
 *
 * An orphan store's sales channel was deleted while its publishable key
 * survived. The dangling link expanded to `sales_channels: [null]`, the
 * unguarded `sc.id` threw, and because the edge middleware treats any non-ok
 * resolve as "no storefront at this host", EVERY partner storefront served the
 * no-tenant 404 — including the ones whose own data was perfectly fine.
 *
 * The lesson these tests pin down: one tenant's dead row must not be able to
 * take down another tenant's storefront.
 */

const key = (id: string, channelIds: (string | null)[]) => ({
  id,
  token: `pk_${id}`,
  sales_channels: channelIds.map((c) => (c === null ? null : { id: c })),
})

const queryReturning = (apiKeys: any[]) => ({
  graph: async () => ({ data: apiKeys }),
})

const partner = (over: any = {}) => ({
  id: "partner_1",
  name: "Sharlho",
  handle: "sharlho",
  metadata: {},
  stores: [
    {
      id: "store_1",
      name: "Sharlho Store",
      default_sales_channel_id: "sc_live",
      default_region_id: "reg_1",
    },
  ],
  ...over,
})

describe("resolveStorefrontForPartner", () => {
  it("resolves the key linked to the partner's sales channel", async () => {
    const q = queryReturning([
      key("apk_other", ["sc_other"]),
      key("apk_mine", ["sc_live"]),
    ])

    const res = await resolveStorefrontForPartner(q as any, partner())

    expect(res.publishable_key).toBe("pk_apk_mine")
    expect(res.sales_channel_id).toBe("sc_live")
    expect(res.store.id).toBe("store_1")
  })

  it("survives ANOTHER tenant's dangling sales-channel link", async () => {
    // The regression. The orphan key sorts BEFORE the real one, so the
    // predicate meets the dead link first — exactly what happened on prod.
    const q = queryReturning([
      key("apk_orphan", [null]),
      key("apk_mine", ["sc_live"]),
    ])

    const res = await resolveStorefrontForPartner(q as any, partner())

    expect(res.publishable_key).toBe("pk_apk_mine")
  })

  it("survives a key whose sales_channels is missing entirely", async () => {
    const q = queryReturning([
      { id: "apk_weird", token: "pk_weird" },
      key("apk_mine", ["sc_live"]),
    ])

    await expect(
      resolveStorefrontForPartner(q as any, partner())
    ).resolves.toMatchObject({ publishable_key: "pk_apk_mine" })
  })

  it("returns a null key rather than throwing when nothing matches", async () => {
    // A partner with no key is a configuration gap, not a crash — and the
    // caller still needs the store/sales-channel it did resolve.
    const q = queryReturning([key("apk_other", ["sc_other"])])

    const res = await resolveStorefrontForPartner(q as any, partner())

    expect(res.publishable_key).toBeNull()
    expect(res.sales_channel_id).toBe("sc_live")
  })

  it("404s a partner with no store", async () => {
    await expect(
      resolveStorefrontForPartner(queryReturning([]) as any, partner({ stores: [] }))
    ).rejects.toThrow(/No store configured/)
  })

  it("404s a store with no default sales channel", async () => {
    const p = partner({
      stores: [{ id: "store_1", name: "S", default_sales_channel_id: null }],
    })

    await expect(
      resolveStorefrontForPartner(queryReturning([]) as any, p)
    ).rejects.toThrow(/No sales channel configured/)
  })
})

describe("hostToCandidates", () => {
  it("lowercases, strips the port and strips a leading www.", () => {
    expect(hostToCandidates("WWW.Sharlho.com:3000")).toEqual({
      host: "sharlho.com",
      subdomain: null,
    })
  })

  it("extracts the first label as a subdomain only when there are 3+ labels", () => {
    expect(hostToCandidates("sharlho.cicilabel.com").subdomain).toBe("sharlho")
    expect(hostToCandidates("sharlho.com").subdomain).toBeNull()
  })

  it("treats an apex custom domain as having no subdomain", () => {
    // Otherwise `uniquepashmina.com` would look for a partner handled
    // "uniquepashmina" via the subdomain path and match by accident.
    expect(hostToCandidates("uniquepashmina.com")).toEqual({
      host: "uniquepashmina.com",
      subdomain: null,
    })
  })
})
