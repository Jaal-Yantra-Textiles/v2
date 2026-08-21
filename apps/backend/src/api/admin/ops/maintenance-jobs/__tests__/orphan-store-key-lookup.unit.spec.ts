import { restoreOrphanStoreJob } from "../restore-orphan-store-job"

/**
 * The publishable key ↔ sales channel relationship is a LINK, not a field on
 * the ApiKey model — `ApiKey` declares only id/token/salt/redacted/title/type/
 * last_used_at/created_by/revoked_by/revoked_at. So the module service cannot
 * filter on `sales_channels` and throws when asked to; only Query resolves
 * links.
 *
 * Both orphan-store jobs asked the module service anyway:
 *
 * - `restore-orphan-store` threw on EVERY real store. A store that does not
 *   exist has no channel id, so the block was skipped and the refusal path
 *   returned a clean 200 — which is exactly why the job looked healthy while
 *   having never once worked. Its presence in the job registry proved it was
 *   deployed, not that it ran.
 * - `delete-orphan-store` made the same call inside a try/catch, so its key
 *   removal — the step its own comment calls load-bearing — threw on its first
 *   line and degraded into an error note, leaving behind the dangling
 *   sales-channel link that took every storefront down.
 *
 * These tests fake the module service the way the real one behaves: it throws
 * on an unknown property. The pure `check*` helpers cannot catch this, which is
 * why every existing test in this folder passed throughout.
 */

const UNKNOWN_PROPERTY = new Error(
  "Trying to query by not existing property ApiKey.sales_channels"
)

const makeContainer = (over: Record<string, any> = {}) => {
  const apiKeyService = {
    listApiKeys: jest.fn(async (filters: any) => {
      if (filters && "sales_channels" in filters) {
        throw UNKNOWN_PROPERTY
      }
      return []
    }),
    revoke: jest.fn(),
    deleteApiKeys: jest.fn(),
  }

  const registry: Record<string, any> = {
    store: {
      listStores: jest.fn(async () => [
        {
          id: "store_1",
          name: "Sharhlo Store",
          deleted_at: "2026-08-20T23:14:28.901Z",
          default_sales_channel_id: "sc_1",
          default_location_id: "loc_1",
        },
      ]),
      restoreStores: jest.fn(),
    },
    sales_channel: {
      listSalesChannels: jest.fn(async () => [
        { id: "sc_1", deleted_at: "2026-08-20T23:14:28.901Z" },
      ]),
      restoreSalesChannels: jest.fn(),
    },
    stock_location: {
      listStockLocations: jest.fn(async () => [
        { id: "loc_1", deleted_at: "2026-08-20T23:14:28.901Z" },
      ]),
      restoreStockLocations: jest.fn(),
    },
    api_key: apiKeyService,
    query: { graph: jest.fn(async () => ({ data: [] })) },
    ...over,
  }

  return {
    container: { resolve: (key: string) => registry[key] } as any,
    registry,
    apiKeyService,
  }
}

describe("restore-orphan-store — counting the keys linked to a channel", () => {
  it("does not throw for a real store with a sales channel", async () => {
    // The regression itself: before the fix this rejected, and the route
    // returned a bare HTML 500 rather than a Medusa error.
    const { container } = makeContainer()

    const result = await restoreOrphanStoreJob.run(container, {
      dry_run: true,
      params: { store_id: "store_1" },
    })

    expect(result.applied).toBe(false)
    expect(result.summary).toContain("Would restore store Sharhlo Store")
  })

  it("resolves the link through Query, never the api_key module service", async () => {
    const { container, registry, apiKeyService } = makeContainer()

    await restoreOrphanStoreJob.run(container, {
      dry_run: true,
      params: { store_id: "store_1" },
    })

    expect(apiKeyService.listApiKeys).not.toHaveBeenCalled()
    expect(registry.query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "api_key",
        filters: expect.objectContaining({
          type: "publishable",
          sales_channels: { id: "sc_1" },
        }),
      })
    )
  })

  it("still refuses a store that does not exist — the path that always worked", async () => {
    const { container } = makeContainer({
      store: { listStores: jest.fn(async () => []), restoreStores: jest.fn() },
    })

    const result = await restoreOrphanStoreJob.run(container, {
      dry_run: true,
      params: { store_id: "store_nope" },
    })

    expect(result.summary).toContain("REFUSED")
  })

  it("reports the surviving key count when Query finds one", async () => {
    const { container } = makeContainer({
      query: { graph: jest.fn(async () => ({ data: [{ id: "apk_1" }] })) },
    })

    const result = await restoreOrphanStoreJob.run(container, {
      dry_run: true,
      params: { store_id: "store_1" },
    })

    // A key IS linked, so the "mint a replacement" warning must not fire.
    expect(
      result.errors.some((e: any) => e.message.includes("recreate_publishable_key"))
    ).toBe(false)
  })
})
