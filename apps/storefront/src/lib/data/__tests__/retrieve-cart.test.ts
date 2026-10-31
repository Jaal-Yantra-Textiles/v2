import { beforeEach, describe, expect, it, vi } from "vitest"

const fetchMock = vi.fn()

vi.mock("@lib/config", () => ({ sdk: { client: { fetch: fetchMock } } }))
vi.mock("@lib/util/medusa-error", () => ({ default: vi.fn() }))
vi.mock("@lib/data/locale-actions", () => ({ getLocale: vi.fn() }))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("../regions", () => ({ getRegion: vi.fn() }))
vi.mock("../cookies", () => ({
  getAuthHeaders: vi.fn(async () => ({})),
  getCacheOptions: vi.fn(async () => ({})),
  getCacheTag: vi.fn(async () => ""),
  getCartId: vi.fn(async () => "cart_cookie"),
  getTrackingCookies: vi.fn(async () => ({})),
  removeCartId: vi.fn(),
  setCartId: vi.fn(),
}))

const { retrieveCart } = await import("../cart")

/**
 * A cart the store API still returns after checkout must read as "no cart".
 * Order #149 (2026-10-28): an abandoned-cart link left the completed cart in
 * the buyer's cookie, and every remove 500'd with "already completed".
 */
describe("retrieveCart", () => {
  beforeEach(() => fetchMock.mockReset())

  it("returns null for a completed cart", async () => {
    fetchMock.mockResolvedValue({
      cart: { id: "cart_1", completed_at: "2026-10-28T06:29:56.891Z" },
    })

    expect(await retrieveCart()).toBeNull()
  })

  it("returns an open cart", async () => {
    fetchMock.mockResolvedValue({ cart: { id: "cart_1", completed_at: null } })

    expect(await retrieveCart()).toEqual({ id: "cart_1", completed_at: null })
  })

  it("asks for completed_at without dropping the caller's fields", async () => {
    fetchMock.mockResolvedValue({ cart: { id: "cart_1" } })

    await retrieveCart("cart_1", "id,region_id,metadata")

    expect(fetchMock.mock.calls[0][1].query.fields).toBe(
      "id,region_id,metadata,+completed_at"
    )
  })
})
