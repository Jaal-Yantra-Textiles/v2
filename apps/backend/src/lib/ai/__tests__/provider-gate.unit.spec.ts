import {
  providerGateKey,
  withProviderSlot,
  resolveMaxConcurrency,
  ProviderBusyError,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_SLOT_TTL_SECONDS,
} from "../provider-gate"

/**
 * A fake of `locking-redis`'s ACTUAL semantics, not a convenient one.
 *
 * ⚠️ The point of writing it this way: a stub that is tidier than reality
 * certifies the wrong code. So this one reproduces the three behaviours the
 * gate's correctness rests on, read out of
 * `@medusajs/locking-redis/dist/services/redis-lock.js`:
 *
 *  1. `awaitQueue` defaults to false → a held key THROWS rather than blocks.
 *  2. Owner `"*"` when none is passed, and a `"*"` lock is releasable by anyone.
 *  3. An expiry is applied ONLY when `expire` is passed; otherwise the lock is
 *     eternal.
 */
class FakeLocking {
  held = new Map<string, { ownerId: string; expiresAt: number | null }>()
  acquireCalls: Array<{ key: string; ownerId: string; expire?: number }> = []

  async acquire(
    key: string,
    args?: { ownerId?: string | null; expire?: number }
  ) {
    const ownerId = args?.ownerId ?? "*"
    this.acquireCalls.push({ key, ownerId, expire: args?.expire })

    const cur = this.held.get(key)
    const live =
      cur && (cur.expiresAt === null || cur.expiresAt > Date.now()) ? cur : null

    if (live && live.ownerId !== ownerId) {
      const e: any = new Error(`Failed to acquire lock for key "${key}"`)
      e.type = "conflict"
      throw e
    }

    this.held.set(key, {
      ownerId,
      expiresAt: args?.expire ? Date.now() + args.expire * 1000 : null,
    })
  }

  async release(key: string, args?: { ownerId?: string | null }) {
    const ownerId = args?.ownerId ?? "*"
    const cur = this.held.get(key)
    if (!cur) return false
    if (cur.ownerId !== "*" && ownerId !== "*" && cur.ownerId !== ownerId) {
      return false
    }
    this.held.delete(key)
    return true
  }
}

const containerWith = (locking: any) => ({
  resolve: (k: string) => {
    if (k === "locking") return locking
    if (k === "logger") return { warn: () => {}, info: () => {}, error: () => {} }
    throw new Error(`not registered: ${k}`)
  },
})

describe("providerGateKey", () => {
  it("keys on the ACCOUNT, so roles sharing one key share one ceiling", () => {
    /**
     * The measured case: eight prod platform rows across seven roles all carry
     * Cloudflare account `9719d38e…`. Two of those roles must land on the same
     * gate key or the ceiling is per-feature and meaningless.
     */
    const imageExtraction = providerGateKey({
      providerType: "cloudflare",
      accountId: "9719d38e64dffe8fd6982afb3a7b25f6",
    })
    const adminAssistant = providerGateKey({
      providerType: "cloudflare",
      accountId: "9719d38e64dffe8fd6982afb3a7b25f6",
    })
    expect(imageExtraction).toBe(adminAssistant)
  })

  it("separates different accounts of the same provider", () => {
    expect(
      providerGateKey({ providerType: "cloudflare", accountId: "acct_a" })
    ).not.toBe(
      providerGateKey({ providerType: "cloudflare", accountId: "acct_b" })
    )
  })

  it("falls back to the base URL when there is no account id", () => {
    expect(
      providerGateKey({
        providerType: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
      })
    ).toContain("api.groq.com")
  })

  it("does not collide two providers that both lack an account", () => {
    expect(providerGateKey({ providerType: "groq" })).not.toBe(
      providerGateKey({ providerType: "bazaarlink" })
    )
  })
})

describe("withProviderSlot", () => {
  it("admits exactly maxConcurrency jobs at once, and no more", async () => {
    const locking = new FakeLocking()
    const container = containerWith(locking)

    let inFlight = 0
    let peak = 0
    let started = 0

    // One resolver per job, so a job is released deliberately rather than by
    // whatever happens to be in a shared array at the time.
    const finish: Array<() => void> = []

    const start = (i: number) =>
      withProviderSlot(
        container,
        "ai-gate:test:acct",
        async () => {
          started++
          inFlight++
          peak = Math.max(peak, inFlight)
          await new Promise<void>((r) => {
            finish[i] = r
          })
          inFlight--
          return i
        },
        { maxConcurrency: 2, waitMs: 10_000 }
      )

    const jobs = [start(0), start(1), start(2)]

    const settle = async (pred: () => boolean, ms = 4_000) => {
      const deadline = Date.now() + ms
      while (!pred() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10))
      }
    }

    // Two get in immediately; the third must be kept out.
    await settle(() => started >= 2)
    await new Promise((r) => setTimeout(r, 100))
    expect(started).toBe(2)
    expect(inFlight).toBe(2)

    // Free one slot — and only then may the third run.
    finish[0]()
    await settle(() => started >= 3)
    expect(started).toBe(3)

    finish[1]()
    finish[2]()
    await Promise.all(jobs)

    // 🔴 The assertion that matters: never THREE at once, whatever the
    // scheduler did in between.
    expect(peak).toBe(2)
  }, 20_000)

  it("🔴 always passes an expire — a slot with no TTL is held forever", async () => {
    const locking = new FakeLocking()
    await withProviderSlot(
      containerWith(locking),
      "ai-gate:test:ttl",
      async () => "done",
      { maxConcurrency: 1 }
    )

    expect(locking.acquireCalls.length).toBeGreaterThan(0)
    for (const call of locking.acquireCalls) {
      // `locking-redis` reads `args?.expire ? ttl : 0`, and 0 means eternal.
      expect(call.expire).toBeGreaterThan(0)
    }
    expect(locking.acquireCalls[0].expire).toBe(DEFAULT_SLOT_TTL_SECONDS)
  })

  it("🔴 never acquires as the wildcard owner", async () => {
    const locking = new FakeLocking()
    await withProviderSlot(
      containerWith(locking),
      "ai-gate:test:owner",
      async () => "done",
      { maxConcurrency: 1 }
    )
    for (const call of locking.acquireCalls) {
      // A `"*"` lock is releasable by anyone, which would let two callers free
      // each other's slot and quietly break the ceiling.
      expect(call.ownerId).not.toBe("*")
    }
  })

  it("releases the slot even when the job throws", async () => {
    const locking = new FakeLocking()
    await expect(
      withProviderSlot(
        containerWith(locking),
        "ai-gate:test:err",
        async () => {
          throw new Error("provider exploded")
        },
        { maxConcurrency: 1 }
      )
    ).rejects.toThrow("provider exploded")

    // A leaked slot after an error would drain the ceiling one failure at a
    // time until nothing could run.
    expect(locking.held.size).toBe(0)
  })

  it("reports busy rather than waiting forever", async () => {
    const locking = new FakeLocking()
    const container = containerWith(locking)
    let free: () => void = () => {}
    const holder = withProviderSlot(
      container,
      "ai-gate:test:busy",
      () => new Promise<void>((r) => (free = r)),
      { maxConcurrency: 1, waitMs: 10_000 }
    )
    await new Promise((r) => setTimeout(r, 20))

    await expect(
      withProviderSlot(container, "ai-gate:test:busy", async () => "nope", {
        maxConcurrency: 1,
        waitMs: 150,
      })
    ).rejects.toBeInstanceOf(ProviderBusyError)

    free()
    await holder
  })

  it("runs ungated rather than failing when locking is not registered", async () => {
    const container = {
      resolve: (k: string) => {
        if (k === "logger") return { warn: () => {} }
        throw new Error("not registered")
      },
    }
    await expect(
      withProviderSlot(container, "ai-gate:test:none", async () => "ran")
    ).resolves.toBe("ran")
  })
})

describe("resolveMaxConcurrency", () => {
  it("defaults when unset", () => {
    expect(resolveMaxConcurrency("groq", {})).toBe(DEFAULT_MAX_CONCURRENCY)
  })

  it("lets one provider be raised without lifting the others", () => {
    const env = { AI_GATE_MAX_CONCURRENCY__GROQ: "8" }
    expect(resolveMaxConcurrency("groq", env)).toBe(8)
    expect(resolveMaxConcurrency("cloudflare", env)).toBe(
      DEFAULT_MAX_CONCURRENCY
    )
  })

  /**
   * 🔴 `Number("")` and `Number(null)` are both `0`, and a ceiling of 0 admits
   * nothing — every AI call would wait out its patience and report busy. The
   * guard has to ask `> 0`, not `!= null`.
   */
  it.each([
    ["empty string", ""],
    ["zero", "0"],
    ["negative", "-3"],
    ["nonsense", "lots"],
  ])("refuses %s and keeps the default", (_label, value) => {
    expect(
      resolveMaxConcurrency("groq", { AI_GATE_MAX_CONCURRENCY: value })
    ).toBe(DEFAULT_MAX_CONCURRENCY)
  })
})
