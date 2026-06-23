/**
 * Unit test — marketing cache SWR shim (#659 slice 3, PR-3b)
 *
 * Verifies the FAIL-SOFT contract when REDIS_URL is unset: no Redis client is
 * created, reads return null (caller falls back to Postgres), writes return
 * false. No live Redis required — exercises the graceful-degradation path the
 * daily-refresh job + read route rely on (spec §4.2).
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="marketing/__tests__/cache"
 */
import {
  getMarketingRedis,
  getHeadlineCache,
  setHeadlineCache,
  MARKETING_HEADLINE_KEY,
  MARKETING_HEADLINE_TTL_SEC,
} from "../cache"

describe("marketing cache — fail-soft without REDIS_URL", () => {
  const prev = process.env.REDIS_URL

  beforeAll(() => {
    delete process.env.REDIS_URL
  })

  afterAll(() => {
    if (prev === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = prev
  })

  it("getMarketingRedis returns null when REDIS_URL is unset", () => {
    expect(getMarketingRedis()).toBeNull()
  })

  it("getHeadlineCache resolves null (Postgres fallback) instead of throwing", async () => {
    await expect(getHeadlineCache()).resolves.toBeNull()
  })

  it("setHeadlineCache resolves false (no-op) instead of throwing", async () => {
    await expect(setHeadlineCache({ headline: null })).resolves.toBe(false)
  })

  it("exposes a namespaced key and a TTL longer than the daily interval", () => {
    expect(MARKETING_HEADLINE_KEY).toBe("marketing:headline")
    expect(MARKETING_HEADLINE_TTL_SEC).toBeGreaterThan(24 * 60 * 60)
  })
})
