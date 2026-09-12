import PacklinkFulfillmentService from "../service"

/**
 * Where the Packlink API key comes from.
 *
 * NOT an env var and NOT SSM: a `socials` platform record of category
 * "shipping" with `provider_type: "packlink"`, the same store Shiprocket
 * already uses. That means an admin rotates the key in the UI without a
 * redeploy, and each partner can hold their OWN Packlink account rather than
 * everyone sharing one platform-wide secret.
 *
 * 🔑 The failure this guards is silent. If the record cannot be read, every
 * quote falls back to a flat number — which looks exactly like a carrier that
 * does not serve the lane. So the fallback must be loud, and the precedence
 * must be pinned.
 */
const logger = () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })

const platform = (api_config: Record<string, any>) => ({
  listSocialPlatforms: jest.fn().mockResolvedValue([
    { name: "Packlink PRO", api_config },
  ]),
})

describe("packlink credential resolution", () => {
  it("prefers the platform record over the configured key", async () => {
    const log = logger()
    const svc: any = new PacklinkFulfillmentService(
      { logger: log as any, socials: platform({ provider_type: "packlink", api_key: "from-platform" }) },
      { api_key: "from-options" }
    )
    const client = await svc.resolveClient()
    expect((client as any).apiKey).toBe("from-platform")
  })

  it("decrypts an encrypted key when the encryption module is present", async () => {
    const decrypt = jest.fn().mockResolvedValue("decrypted-key")
    const svc: any = new PacklinkFulfillmentService(
      {
        logger: logger() as any,
        socials: platform({ provider_type: "packlink", api_key_encrypted: "cipher" }),
        encryption: { decrypt },
      },
      { api_key: "from-options" }
    )
    const client = await svc.resolveClient()
    // Assert on the call, not inside the mock — an expect() inside a mock that
    // is swallowed by a catch proves nothing.
    expect(decrypt).toHaveBeenCalledWith("cipher")
    expect((client as any).apiKey).toBe("decrypted-key")
  })

  it("carries the partner's OWN origin from the record", async () => {
    const svc: any = new PacklinkFulfillmentService(
      {
        logger: logger() as any,
        socials: platform({
          provider_type: "packlink",
          api_key: "k",
          origin_country: "IT",
          origin_zip: "50022",
        }),
      },
      { origin_country: "XX", origin_zip: "99999" }
    )
    await svc.resolveClient()
    expect(svc.platformOrigin).toEqual({ country: "IT", zip: "50022" })
  })

  it("falls back LOUDLY when socials is missing from the cradle", async () => {
    // This branch means `dependencies` was dropped from the fulfillment module
    // in one of the two config files — invisible otherwise.
    const log = logger()
    const svc: any = new PacklinkFulfillmentService(
      { logger: log as any },
      { api_key: "from-options" }
    )
    const client = await svc.resolveClient()
    expect((client as any).apiKey).toBe("from-options")
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("no `socials`"))
  })

  it("falls back loudly when no packlink record exists", async () => {
    const log = logger()
    const svc: any = new PacklinkFulfillmentService(
      {
        logger: log as any,
        socials: { listSocialPlatforms: jest.fn().mockResolvedValue([{ name: "Shiprocket", api_config: { provider_type: "shiprocket" } }]) },
      },
      { api_key: "from-options" }
    )
    const client = await svc.resolveClient()
    expect((client as any).apiKey).toBe("from-options")
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("not found"))
  })

  it("survives the platform lookup throwing", async () => {
    const log = logger()
    const svc: any = new PacklinkFulfillmentService(
      { logger: log as any, socials: { listSocialPlatforms: jest.fn().mockRejectedValue(new Error("db down")) } },
      { api_key: "from-options" }
    )
    const client = await svc.resolveClient()
    expect((client as any).apiKey).toBe("from-options")
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("db down"))
  })

  it("looks the record up ONCE, not per quote", async () => {
    const socials = platform({ provider_type: "packlink", api_key: "k" })
    const svc: any = new PacklinkFulfillmentService({ logger: logger() as any, socials }, {})
    await svc.resolveClient()
    await svc.resolveClient()
    await svc.resolveClient()
    expect(socials.listSocialPlatforms).toHaveBeenCalledTimes(1)
  })
})
