import FxRatesService from "../service"

/**
 * `getRateLive` is the reader that money goes through, so its failure modes
 * matter more than its happy path:
 *
 *  - a stale cache must not be read silently (#1538 — a remembered rate 24% off)
 *  - N concurrent lines must not cause N provider fetches (#1368 — unbounded
 *    FX fanout OOM-killed production twice)
 *  - a provider outage must not lose a payout that a cached rate could serve
 *  - but a MISSING rate must still throw, because `convertAmount` treats the
 *    absence of a rate as a refusal, never as 1
 *
 * The service is a MedusaService subclass, so the prototype is borrowed and the
 * data accessors stubbed — this exercises the real `getRateLive` body rather
 * than a reimplementation of it.
 */
const makeService = (overrides: Record<string, any>): any => {
  const service: any = Object.create(FxRatesService.prototype)
  service.refreshInFlight = null
  Object.assign(service, overrides)
  return service
}

const HOUR = 60 * 60 * 1000

describe("getRateLive", () => {
  it("returns 1 for the same currency without touching the cache or provider", async () => {
    const getRate = jest.fn()
    const refreshRatesFromProvider = jest.fn()
    const service = makeService({
      getRate,
      refreshRatesFromProvider,
      getLastFetchedAt: jest.fn(),
    })

    await expect(service.getRateLive("inr", "INR")).resolves.toBe(1)
    expect(getRate).not.toHaveBeenCalled()
    expect(refreshRatesFromProvider).not.toHaveBeenCalled()
  })

  it("serves a fresh cached rate without calling the provider", async () => {
    const refreshRatesFromProvider = jest.fn()
    const service = makeService({
      getRate: jest.fn().mockResolvedValue(96.49),
      getLastFetchedAt: jest.fn().mockResolvedValue(new Date(Date.now() - HOUR)),
      refreshRatesFromProvider,
    })

    await expect(service.getRateLive("usd", "inr")).resolves.toBe(96.49)
    expect(refreshRatesFromProvider).not.toHaveBeenCalled()
  })

  it("refreshes when the cache is older than the max age", async () => {
    const getRate = jest
      .fn()
      .mockResolvedValueOnce(80) // the stale figure
      .mockResolvedValueOnce(96.49) // after the refresh
    const refreshRatesFromProvider = jest.fn().mockResolvedValue({})
    const service = makeService({
      getRate,
      // A month old — the shape #1512 is about.
      getLastFetchedAt: jest
        .fn()
        .mockResolvedValue(new Date(Date.now() - 30 * 24 * HOUR)),
      refreshRatesFromProvider,
    })

    await expect(service.getRateLive("usd", "inr")).resolves.toBe(96.49)
    expect(refreshRatesFromProvider).toHaveBeenCalledTimes(1)
  })

  it("refreshes when the pair is missing from the cache entirely", async () => {
    const getRate = jest
      .fn()
      .mockRejectedValueOnce(new Error("no path from usd to inr"))
      .mockResolvedValueOnce(96.49)
    const refreshRatesFromProvider = jest.fn().mockResolvedValue({})
    const service = makeService({
      getRate,
      getLastFetchedAt: jest.fn().mockResolvedValue(new Date()),
      refreshRatesFromProvider,
    })

    await expect(service.getRateLive("usd", "inr")).resolves.toBe(96.49)
    expect(refreshRatesFromProvider).toHaveBeenCalledTimes(1)
  })

  it("refreshes ONCE for many concurrent lines, not once each", async () => {
    // #1368: unbounded FX fanout OOM-killed production twice.
    let resolveFetch: (v: unknown) => void = () => {}
    const refreshRatesFromProvider = jest.fn(
      () => new Promise((res) => { resolveFetch = res })
    )
    const service = makeService({
      getRate: jest.fn().mockResolvedValue(96.49),
      getLastFetchedAt: jest.fn().mockResolvedValue(new Date(0)),
      refreshRatesFromProvider,
    })

    const inflight = Promise.all(
      Array.from({ length: 8 }, () => service.getRateLive("usd", "inr"))
    )
    // Let all eight reach the refresh before it settles.
    await Promise.resolve()
    await Promise.resolve()
    resolveFetch({})
    await inflight

    expect(refreshRatesFromProvider).toHaveBeenCalledTimes(1)
  })

  it("falls back to the stale cached rate when the provider is unreachable", async () => {
    const service = makeService({
      getRate: jest.fn().mockResolvedValue(88),
      getLastFetchedAt: jest.fn().mockResolvedValue(new Date(0)),
      refreshRatesFromProvider: jest
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED")),
    })

    // A stale rate beats refusing a payout outright.
    await expect(service.getRateLive("usd", "inr")).resolves.toBe(88)
  })

  it("still throws when the provider is unreachable AND nothing is cached", async () => {
    // 🔴 The one case that must NOT resolve. `convertAmount` reads a missing
    // rate as a refusal; anything returned here would be treated as real.
    const service = makeService({
      getRate: jest.fn().mockRejectedValue(new Error("no path")),
      getLastFetchedAt: jest.fn().mockResolvedValue(null),
      refreshRatesFromProvider: jest
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED")),
    })

    await expect(service.getRateLive("usd", "inr")).rejects.toThrow(
      /ECONNREFUSED/
    )
  })

  it("throws when the refresh succeeds but the pair still does not exist", async () => {
    const service = makeService({
      getRate: jest.fn().mockRejectedValue(new Error("no path from usd to xyz")),
      getLastFetchedAt: jest.fn().mockResolvedValue(null),
      refreshRatesFromProvider: jest.fn().mockResolvedValue({}),
    })

    await expect(service.getRateLive("usd", "xyz")).rejects.toThrow(/no path/)
  })

  it("honours an explicit maxAgeMs", async () => {
    const refreshRatesFromProvider = jest.fn().mockResolvedValue({})
    const service = makeService({
      getRate: jest.fn().mockResolvedValue(96.49),
      getLastFetchedAt: jest.fn().mockResolvedValue(new Date(Date.now() - 2 * HOUR)),
      refreshRatesFromProvider,
    })

    // Two hours old: fine at the 24h default, stale at a 1h ceiling.
    await service.getRateLive("usd", "inr")
    expect(refreshRatesFromProvider).not.toHaveBeenCalled()

    await service.getRateLive("usd", "inr", { maxAgeMs: HOUR })
    expect(refreshRatesFromProvider).toHaveBeenCalledTimes(1)
  })
})
