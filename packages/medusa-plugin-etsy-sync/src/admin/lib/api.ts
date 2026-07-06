import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: "/",
  auth: {
    type: "session",
  },
})

export const etsyApi = {
  status: () =>
    sdk.client.fetch<{ connected: boolean; shop_id?: string; shop_name?: string }>(
      "/admin/etsy/status"
    ),
  getSettings: () =>
    sdk.client.fetch<Record<string, any>>("/admin/etsy/settings"),
  saveSettings: (settings: Record<string, any>) =>
    sdk.client.fetch("/admin/etsy/settings", {
      method: "POST",
      body: settings,
    }),
  authorize: () =>
    sdk.client.fetch<{ authorization_url: string; state: string }>(
      "/admin/etsy/auth/authorize"
    ),
  callback: (code: string, state: string) =>
    sdk.client.fetch("/admin/etsy/auth/callback", {
      method: "POST",
      body: { code, state },
    }),
  disconnect: () =>
    sdk.client.fetch("/admin/etsy/auth/disconnect", { method: "POST" }),
  syncProduct: (id: string) =>
    sdk.client.fetch(`/admin/etsy/sync/product/${id}`, { method: "POST" }),
  productStatus: (id: string) =>
    sdk.client.fetch<{
      connected: boolean
      synced: boolean
      latest: any | null
    }>(`/admin/etsy/status/product/${id}`),
  syncBulk: (product_ids: string[]) =>
    sdk.client.fetch<{ batch_id: string; status: string }>(
      "/admin/etsy/sync/bulk",
      {
        method: "POST",
        body: { product_ids },
      }
    ),
  bulkStatus: (batchId: string) =>
    sdk.client.fetch<{ batch: any; progress: any }>(
      `/admin/etsy/sync/bulk/${batchId}`
    ),
  listSyncs: (opts: { take?: number; skip?: number; status?: string } = {}) => {
    const query: Record<string, string> = {}
    if (opts.take !== undefined) query.take = String(opts.take)
    if (opts.skip !== undefined) query.skip = String(opts.skip)
    if (opts.status) query.status = opts.status
    return sdk.client.fetch("/admin/etsy/syncs", { query })
  },
  getSync: (id: string) =>
    sdk.client.fetch(`/admin/etsy/syncs/${id}`),
  retrySync: (id: string) =>
    sdk.client.fetch(`/admin/etsy/syncs/${id}`, { method: "POST" }),
  shippingProfiles: () =>
    sdk.client.fetch("/admin/etsy/shipping-profiles"),
  returnPolicies: () =>
    sdk.client.fetch("/admin/etsy/return-policies"),
  taxonomy: () =>
    sdk.client.fetch("/admin/etsy/taxonomy"),
  readinessStates: () =>
    sdk.client.fetch("/admin/etsy/readiness-states"),
}
