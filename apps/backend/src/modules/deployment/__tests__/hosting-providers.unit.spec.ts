import { sanitizeProjectName } from "../providers/types"
import {
  createHostingProvider,
  hostingProviderForAccount,
  resolveAccountCredentials,
  type DeploymentApiConfig,
} from "../providers/registry"
import { VercelHostingProvider } from "../providers/vercel-provider"
import { CloudflarePagesProvider } from "../providers/cloudflare-pages-provider"
import type { EncryptedData } from "../../encryption/service"

const enc = (s: string): EncryptedData => ({
  encrypted: s,
  iv: "iv",
  authTag: "tag",
  keyVersion: 1,
})

// Fake decryptor: round-trips the fake `enc()` above.
const decryptor = { decrypt: (d: EncryptedData) => d.encrypted }

describe("sanitizeProjectName", () => {
  it("lowercases, replaces unsafe chars, collapses/trims dashes", () => {
    expect(sanitizeProjectName("Storefront For ACME Ltd.")).toBe("storefront-for-acme-ltd")
    expect(sanitizeProjectName("--weird__name!!")).toBe("weird-name")
  })
  it("caps length at 58 (Cloudflare Pages ceiling)", () => {
    expect(sanitizeProjectName("a".repeat(80)).length).toBe(58)
  })
})

describe("resolveAccountCredentials", () => {
  it("decrypts token_encrypted with the decryptor", () => {
    const cfg: DeploymentApiConfig = { token_encrypted: enc("secret-tok"), team_id: "team_1" }
    const creds = resolveAccountCredentials(cfg, decryptor)
    expect(creds).toEqual({ token: "secret-tok", teamId: "team_1", accountId: undefined })
  })
  it("tolerates a plaintext token fallback (local/dev)", () => {
    const creds = resolveAccountCredentials({ token: "plain", account_id: "acc_1" }, undefined)
    expect(creds).toEqual({ token: "plain", teamId: undefined, accountId: "acc_1" })
  })
  it("throws when encrypted but no decryptor", () => {
    expect(() => resolveAccountCredentials({ token_encrypted: enc("x") })).toThrow(/no decryptor/)
  })
  it("throws when there is no token at all", () => {
    expect(() => resolveAccountCredentials({ team_id: "t" })).toThrow(/no token/)
  })
})

describe("createHostingProvider", () => {
  it("builds a Vercel provider", () => {
    const p = createHostingProvider("vercel", { token: "t" })
    expect(p).toBeInstanceOf(VercelHostingProvider)
    expect(p.provider).toBe("vercel")
  })
  it("builds a Cloudflare Pages provider", () => {
    const p = createHostingProvider("cloudflare", { token: "t", accountId: "acc" })
    expect(p).toBeInstanceOf(CloudflarePagesProvider)
    expect(p.provider).toBe("cloudflare")
  })
  it("throws for not-yet-implemented providers (S5)", () => {
    expect(() => createHostingProvider("render", { token: "t" })).toThrow(/not implemented/)
    expect(() => createHostingProvider("netlify", { token: "t" })).toThrow(/not implemented/)
  })
})

describe("provider constructors validate creds", () => {
  it("Vercel requires a token", () => {
    expect(() => new VercelHostingProvider({ token: "" })).toThrow(/token/)
  })
  it("Cloudflare requires token + accountId", () => {
    expect(() => new CloudflarePagesProvider({ token: "t" })).toThrow(/accountId/)
    expect(() => new CloudflarePagesProvider({ token: "", accountId: "a" })).toThrow(/token/)
  })
})

describe("dnsTarget", () => {
  it("Vercel points at the generic CNAME", () => {
    const p = new VercelHostingProvider({ token: "t" })
    expect(p.dnsTarget({ id: "prj", name: "prj" })).toBe("cname.vercel-dns.com")
  })
  it("Cloudflare Pages points at <project>.pages.dev, preferring the API subdomain", () => {
    const p = new CloudflarePagesProvider({ token: "t", accountId: "a" })
    expect(p.dnsTarget({ id: "shop", name: "shop" })).toBe("shop.pages.dev")
    expect(p.dnsTarget({ id: "shop", name: "shop", originHost: "custom.pages.dev" })).toBe(
      "custom.pages.dev"
    )
  })
})

describe("hostingProviderForAccount", () => {
  it("resolves creds and builds the matching provider", () => {
    const p = hostingProviderForAccount(
      { provider: "cloudflare", api_config: { token_encrypted: enc("cf-tok"), account_id: "acc_9" } },
      decryptor
    )
    expect(p).toBeInstanceOf(CloudflarePagesProvider)
  })
})
