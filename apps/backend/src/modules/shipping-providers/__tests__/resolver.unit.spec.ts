import { MedusaError } from "@medusajs/framework/utils"
import { resolveShippingProvider } from "../resolver"
import { ShiprocketClient } from "../shiprocket/client"

/**
 * Container-mocked unit coverage for the Shiprocket env-fallback (#642).
 * A fake container whose `resolve` always throws forces the resolver down the
 * env-var path (no socials platform record, no encryption module).
 */
const throwingContainer = {
  resolve() {
    throw new Error("module unavailable")
  },
} as any

describe("resolveShippingProvider — Shiprocket env fallback (#642)", () => {
  const saved = {
    email: process.env.SHIPROCKET_EMAIL,
    password: process.env.SHIPROCKET_PASSWORD,
    apiPassword: process.env.SHIPROCKET_API_PASSWORD,
  }

  afterEach(() => {
    for (const k of [
      "SHIPROCKET_EMAIL",
      "SHIPROCKET_PASSWORD",
      "SHIPROCKET_API_PASSWORD",
    ] as const) {
      delete process.env[k]
    }
  })

  afterAll(() => {
    if (saved.email !== undefined) process.env.SHIPROCKET_EMAIL = saved.email
    if (saved.password !== undefined)
      process.env.SHIPROCKET_PASSWORD = saved.password
    if (saved.apiPassword !== undefined)
      process.env.SHIPROCKET_API_PASSWORD = saved.apiPassword
  })

  it("authenticates from SHIPROCKET_API_PASSWORD (repo convention)", async () => {
    process.env.SHIPROCKET_EMAIL = "shipping@example.com"
    process.env.SHIPROCKET_API_PASSWORD = "from-api-password"
    const client = await resolveShippingProvider(throwingContainer, "shiprocket")
    expect(client).toBeInstanceOf(ShiprocketClient)
  })

  it("still accepts the legacy SHIPROCKET_PASSWORD name", async () => {
    process.env.SHIPROCKET_EMAIL = "shipping@example.com"
    process.env.SHIPROCKET_PASSWORD = "from-legacy-password"
    const client = await resolveShippingProvider(throwingContainer, "shiprocket")
    expect(client).toBeInstanceOf(ShiprocketClient)
  })

  it("throws a clean MedusaError naming both env vars when neither is set", async () => {
    process.env.SHIPROCKET_EMAIL = "shipping@example.com"
    await expect(
      resolveShippingProvider(throwingContainer, "shiprocket")
    ).rejects.toThrow(MedusaError)
    await expect(
      resolveShippingProvider(throwingContainer, "shiprocket")
    ).rejects.toThrow(/SHIPROCKET_API_PASSWORD/)
  })
})
