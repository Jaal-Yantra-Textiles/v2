import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: "/",
  auth: {
    type: "session",
  },
})

export const faireApi = {
  status: () =>
    sdk.client.fetch<{
      connected: boolean
      account: any | null
      settings: any
      readiness: {
        connected: boolean
        brand: boolean
        wholesale_pricing: boolean
        taxonomy: boolean
        ready_to_publish: boolean
      }
    }>("/admin/faire/status"),
  getSettings: () =>
    sdk.client.fetch<Record<string, any>>("/admin/faire/settings"),
  saveSettings: (settings: Record<string, any>) =>
    sdk.client.fetch("/admin/faire/settings", {
      method: "POST",
      body: settings,
    }),
  authorize: () =>
    sdk.client.fetch<{ authorization_url: string; state: string }>(
      "/admin/faire/auth/authorize"
    ),
  callback: (code: string, state: string) =>
    sdk.client.fetch("/admin/faire/auth/callback", {
      method: "POST",
      body: { code, state },
    }),
  connectApiKey: (access_token: string) =>
    sdk.client.fetch("/admin/faire/auth/api-key", {
      method: "POST",
      body: { access_token },
    }),
  disconnect: () =>
    sdk.client.fetch("/admin/faire/auth/disconnect", { method: "POST" }),
  syncProduct: (id: string) =>
    sdk.client.fetch(`/admin/faire/sync/product/${id}`, { method: "POST" }),
  productStatus: (id: string) =>
    sdk.client.fetch<{
      connected: boolean
      synced: boolean
      latest: any | null
    }>(`/admin/faire/status/product/${id}`),
  syncBulk: (product_ids: string[]) =>
    sdk.client.fetch<{ batch_id: string; status: string }>(
      "/admin/faire/sync/bulk",
      {
        method: "POST",
        body: { product_ids },
      }
    ),
  bulkStatus: (batchId: string) =>
    sdk.client.fetch<{ batch: any; progress: any }>(
      `/admin/faire/sync/bulk/${batchId}`
    ),
  ingestOrders: (limit?: number) =>
    sdk.client.fetch<{ batch_id: string; status: string }>(
      "/admin/faire/ingest/orders",
      { method: "POST", body: limit != null ? { limit } : {} }
    ),
  ingestStatus: (batchId: string) =>
    sdk.client.fetch<{ batch: any; progress: any }>(
      `/admin/faire/ingest/orders/${batchId}`
    ),
  listSyncs: (opts: { take?: number; skip?: number; status?: string } = {}) => {
    const query: Record<string, string> = {}
    if (opts.take !== undefined) query.take = String(opts.take)
    if (opts.skip !== undefined) query.skip = String(opts.skip)
    if (opts.status) query.status = opts.status
    return sdk.client.fetch("/admin/faire/syncs", { query })
  },
  getSync: (id: string) => sdk.client.fetch(`/admin/faire/syncs/${id}`),
  retrySync: (id: string) =>
    sdk.client.fetch(`/admin/faire/syncs/${id}`, { method: "POST" }),
  deleteSync: (id: string) =>
    sdk.client.fetch(`/admin/faire/syncs/${id}`, { method: "DELETE" }),
  brand: () => sdk.client.fetch("/admin/faire/brand"),
  taxonomy: (opts: { q?: string; limit?: number; ids?: string[] } = {}) => {
    const query: Record<string, string> = {}
    if (opts.q) query.q = opts.q
    if (opts.limit !== undefined) query.limit = String(opts.limit)
    if (opts.ids?.length) query.ids = opts.ids.join(",")
    return sdk.client.fetch<{
      taxonomy: Array<{ id: string; name: string }>
      count: number
      total: number
    }>("/admin/faire/taxonomy", { query })
  },
  products: (opts: { limit?: number; page?: string; updated_at_min?: string } = {}) => {
    const query: Record<string, string> = {}
    if (opts.limit !== undefined) query.limit = String(opts.limit)
    if (opts.page !== undefined) query.page = String(opts.page)
    if (opts.updated_at_min !== undefined) query.updated_at_min = opts.updated_at_min
    return sdk.client.fetch("/admin/faire/products", { query })
  },
}
