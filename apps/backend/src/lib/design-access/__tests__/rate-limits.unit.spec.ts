import {
  createFixedWindowLimiter,
  createKeyedRateLimitMiddleware,
  consumeImageGeneration,
  ImageGenRateLimitError,
  IMAGE_GEN_LIMIT_PER_DESIGN,
  imageGenDesignLimiter,
  imageGenGlobalLimiter,
  imageGenIpLimiter,
  retryAfterMinutes,
} from "../rate-limits"

describe("design chat rate limits (#2543)", () => {
  it("fixed window: allows max hits, refuses the next, resets after the window", () => {
    let now = 1_000
    const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 3 }, () => now)
    expect(limiter.hit("k").allowed).toBe(true)
    expect(limiter.hit("k").allowed).toBe(true)
    expect(limiter.hit("k").allowed).toBe(true)
    const refused = limiter.hit("k")
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterMs).toBe(60_000)
    // Other keys are independent.
    expect(limiter.hit("other").allowed).toBe(true)
    now += 60_000
    expect(limiter.hit("k").allowed).toBe(true)
  })

  it("rounds retry-after up to whole minutes, never below 1", () => {
    expect(retryAfterMinutes(1)).toBe(1)
    expect(retryAfterMinutes(61_000)).toBe(2)
  })

  it("middleware: 429 with Retry-After once a key is exhausted, without counting refused hits", () => {
    const limiter = createFixedWindowLimiter({ windowMs: 300_000, max: 2 })
    const mw = createKeyedRateLimitMiddleware([
      { limiter, keyOf: (req) => `ip:${req.ip}` },
    ])
    const res: any = {
      headers: {} as Record<string, string>,
      statusCode: 200,
      body: null,
      setHeader(k: string, v: string) {
        this.headers[k] = v
      },
      status(c: number) {
        this.statusCode = c
        return this
      },
      json(b: any) {
        this.body = b
        return this
      },
    }
    const next = jest.fn()
    mw({ ip: "1.1.1.1" }, res, next)
    mw({ ip: "1.1.1.1" }, res, next)
    expect(next).toHaveBeenCalledTimes(2)
    mw({ ip: "1.1.1.1" }, res, next)
    expect(next).toHaveBeenCalledTimes(2)
    expect(res.statusCode).toBe(429)
    expect(res.body.code).toBe("rate_limited")
    expect(res.body.message).toMatch(/Try again in 5 min/)
    expect(Number(res.headers["Retry-After"])).toBeGreaterThan(0)
  })

  describe("image generation", () => {
    beforeEach(() => {
      imageGenDesignLimiter.reset()
      imageGenIpLimiter.reset()
      imageGenGlobalLimiter.reset()
    })

    it(`caps one design at ${IMAGE_GEN_LIMIT_PER_DESIGN.max} per hour`, () => {
      for (let i = 0; i < IMAGE_GEN_LIMIT_PER_DESIGN.max; i++) {
        // A different IP each time — the design cap must still bite.
        consumeImageGeneration({ designId: "d1", ip: `10.0.0.${i}` })
      }
      expect(() => consumeImageGeneration({ designId: "d1", ip: "10.0.1.1" })).toThrow(
        ImageGenRateLimitError
      )
      // Another design is unaffected.
      expect(() => consumeImageGeneration({ designId: "d2", ip: "10.0.1.1" })).not.toThrow()
    })

    it("caps one IP across designs", () => {
      let thrown: unknown = null
      try {
        for (let i = 0; i < 100; i++) consumeImageGeneration({ designId: `d-${i}`, ip: "9.9.9.9" })
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(ImageGenRateLimitError)
      expect((thrown as Error).message).toMatch(/Try again in \d+ min/)
    })

    it("does not pool requests with an unknown IP into one shared bucket", () => {
      for (let i = 0; i < 50; i++) {
        consumeImageGeneration({ designId: `u-${i}`, ip: "unknown" })
      }
    })
  })
})
