import ShiprocketFulfillmentService from "../service"

/**
 * The two credential paths, and the one that was reading the blank half.
 *
 * 🔴 Shiprocket's label/pickup/track calls go through `resolveShippingProvider`,
 * which reads the `category:shipping` SocialPlatform record. `calculatePrice`
 * did not — it used the client built from MODULE OPTIONS, i.e. env, and
 * `SHIPROCKET_PASSWORD` is deliberately unset in both `.env` and the copilot
 * manifest ("the password/pickup are intentionally NOT wired as env here").
 *
 * So every live rate call posted `password: undefined` and Shiprocket answered
 * `422 — password: The password is required`, once per shipping-options
 * request, while the rest of the carrier worked perfectly.
 */
const ENV_OPTIONS = {
  email: "env@jaalyantra.com",
  password: undefined as any, // exactly what prod has: the env var is unset
  pickup_location: "Primary",
}

const PLATFORM_RECORD = {
  name: "Shiprocket",
  api_config: {
    provider: "shiprocket",
    email: "shipping@jaalyantra.com",
    password: "the-real-one",
    mode: "live",
  },
}

const loggerStub = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})

const build = (opts: { socials?: any; encryption?: any } = {}) => {
  const logger = loggerStub()
  const svc = new ShiprocketFulfillmentService(
    { logger, socials: opts.socials, encryption: opts.encryption } as any,
    ENV_OPTIONS as any
  )
  return { svc: svc as any, logger }
}

describe("shiprocket rating credentials", () => {
  it("🔴 uses the SocialPlatform record, not the unset env password", async () => {
    const listSocialPlatforms = jest.fn(async (_f: any) => [PLATFORM_RECORD])
    const { svc } = build({ socials: { listSocialPlatforms } })

    const client = await svc.resolveClient()

    expect(listSocialPlatforms).toHaveBeenCalledWith({
      category: "shipping",
      status: "active",
    })
    // The client that will do the rate call carries the real credentials.
    expect(client.email).toBe("shipping@jaalyantra.com")
    expect(client.password).toBe("the-real-one")
  })

  it("caches the lookup — a login per rate call would be absurd", async () => {
    const listSocialPlatforms = jest.fn(async (_f: any) => [PLATFORM_RECORD])
    const { svc } = build({ socials: { listSocialPlatforms } })

    const a = await svc.resolveClient()
    const b = await svc.resolveClient()

    expect(a).toBe(b)
    expect(listSocialPlatforms).toHaveBeenCalledTimes(1)
  })

  it("🔴 warns LOUDLY when the cradle has no socials — the dependency was dropped", async () => {
    // This branch means `dependencies: [SOCIALS_MODULE, ENCRYPTION_MODULE]` was
    // removed from the fulfillment module registration. The failure it causes
    // is otherwise completely silent, which is how it went unnoticed.
    const { svc, logger } = build({ socials: undefined })

    const client = await svc.resolveClient()

    expect(client.email).toBe("env@jaalyantra.com")
    expect(logger.warn).toHaveBeenCalled()
    expect(String(logger.warn.mock.calls[0][0])).toMatch(/dependencies/i)
  })

  it("falls back, and says so, when no shiprocket record exists", async () => {
    const listSocialPlatforms = jest.fn(async (_f: any) => [
      { name: "Blue Dart", api_config: { provider: "bluedart" } },
    ])
    const { svc, logger } = build({ socials: { listSocialPlatforms } })

    const client = await svc.resolveClient()

    expect(client.email).toBe("env@jaalyantra.com")
    expect(logger.warn).toHaveBeenCalled()
  })

  it("falls back when the record names an email but no password", async () => {
    const listSocialPlatforms = jest.fn(async (_f: any) => [
      { name: "Shiprocket", api_config: { provider: "shiprocket", email: "x@y.com" } },
    ])
    const { svc, logger } = build({ socials: { listSocialPlatforms } })

    const client = await svc.resolveClient()

    // A half-configured record must not produce a client that fails auth in a
    // new way — better the known env behaviour plus a warning.
    expect(client.email).toBe("env@jaalyantra.com")
    expect(logger.warn).toHaveBeenCalled()
  })

  it("decrypts an encrypted password when the encryption module is present", async () => {
    const listSocialPlatforms = jest.fn(async (_f: any) => [
      {
        name: "Shiprocket",
        api_config: {
          provider: "shiprocket",
          email: "shipping@jaalyantra.com",
          password_encrypted: "cipher-text",
        },
      },
    ])
    const decrypt = jest.fn(async (_v: string) => "decrypted-secret")
    const { svc } = build({
      socials: { listSocialPlatforms },
      encryption: { decrypt },
    })

    const client = await svc.resolveClient()

    expect(decrypt).toHaveBeenCalledWith("cipher-text")
    expect(client.password).toBe("decrypted-secret")
  })

  it("never throws when the socials lookup fails — rating degrades, it does not break", async () => {
    const listSocialPlatforms = jest.fn(async (_f: any) => {
      throw new Error("db is having a moment")
    })
    const { svc, logger } = build({ socials: { listSocialPlatforms } })

    const client = await svc.resolveClient()

    expect(client.email).toBe("env@jaalyantra.com")
    expect(logger.warn).toHaveBeenCalled()
  })
})
