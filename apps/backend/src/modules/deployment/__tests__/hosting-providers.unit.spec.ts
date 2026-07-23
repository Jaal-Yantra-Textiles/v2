import {
  sanitizeProjectName,
  isApexDomain,
  dnsHostLabel,
  cnameInstruction,
} from "../providers/types"
import {
  partnerHostingProviderName,
  partnerProjectRef,
} from "../providers/resolve-partner-provider"
import {
  createHostingProvider,
  hostingProviderForAccount,
  resolveAccountCredentials,
  type DeploymentApiConfig,
} from "../providers/registry"
import { VercelHostingProvider } from "../providers/vercel-provider"
import { CloudflareWorkersProvider } from "../providers/cloudflare-workers-provider"
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
    expect(p).toBeInstanceOf(CloudflareWorkersProvider)
    expect(p.provider).toBe("cloudflare")
  })
  it("builds Netlify + Render providers (S5)", () => {
    expect(
      createHostingProvider("netlify", { token: "t", accountId: "a", extra: { github_installation_id: "1" } })
        .provider
    ).toBe("netlify")
    expect(
      createHostingProvider("render", { token: "t", extra: { owner_id: "tea_1" } }).provider
    ).toBe("render")
  })
  it("throws for an unknown provider", () => {
    expect(() => createHostingProvider("fly" as any, { token: "t" })).toThrow(/Unknown hosting provider/)
  })
})

describe("provider constructors validate creds", () => {
  it("Vercel requires a token", () => {
    expect(() => new VercelHostingProvider({ token: "" })).toThrow(/token/)
  })
  it("Cloudflare requires token + accountId", () => {
    expect(() => new CloudflareWorkersProvider({ token: "t" })).toThrow(/accountId/)
    expect(() => new CloudflareWorkersProvider({ token: "", accountId: "a" })).toThrow(/token/)
  })
})

describe("dnsTarget", () => {
  it("Vercel points at the generic CNAME", () => {
    const p = new VercelHostingProvider({ token: "t" })
    expect(p.dnsTarget({ id: "prj", name: "prj" })).toBe("cname.vercel-dns.com")
  })
  it("Cloudflare Workers points at <project>.<accountId>.workers.dev, preferring the API originHost", () => {
    const p = new CloudflareWorkersProvider({ token: "t", accountId: "a" })
    expect(p.dnsTarget({ id: "shop", name: "shop" })).toBe("shop.a.workers.dev")
    expect(p.dnsTarget({ id: "shop", name: "shop", originHost: "custom.workers.dev" })).toBe(
      "custom.workers.dev"
    )
  })
})

describe("DNS instruction helpers", () => {
  it("isApexDomain distinguishes apex from subdomains", () => {
    expect(isApexDomain("example.com")).toBe(true)
    expect(isApexDomain("shop.example.com")).toBe(false)
    expect(isApexDomain("www.example.com")).toBe(false)
  })
  it("dnsHostLabel yields @ for apex, else the subdomain part", () => {
    expect(dnsHostLabel("example.com")).toBe("@")
    expect(dnsHostLabel("shop.example.com")).toBe("shop")
    expect(dnsHostLabel("a.b.example.com")).toBe("a.b")
  })
  it("cnameInstruction builds a CNAME record for the host label", () => {
    expect(cnameInstruction("shop.example.com", "foo.pages.dev")).toEqual({
      type: "CNAME",
      host: "shop",
      value: "foo.pages.dev",
    })
  })
})

describe("resolve-partner-provider selection (pure)", () => {
  it("defaults to vercel for pre-#884 partners, honours hosting_provider when set", () => {
    expect(partnerHostingProviderName({})).toBe("vercel")
    expect(partnerHostingProviderName({ vercel_project_id: "prj_1" })).toBe("vercel")
    expect(partnerHostingProviderName({ hosting_provider: "cloudflare" })).toBe("cloudflare")
    expect(partnerHostingProviderName({ metadata: { hosting_provider: "render" } })).toBe("render")
    expect(partnerHostingProviderName({ hosting_provider: "bogus" })).toBe("vercel")
  })
  it("picks the project id for Vercel and the project name for Cloudflare Pages", () => {
    const partner = {
      vercel_project_id: "prj_abc",
      vercel_project_name: "storefront-acme",
    }
    expect(partnerProjectRef(partner, "vercel")).toBe("prj_abc")
    expect(partnerProjectRef(partner, "cloudflare")).toBe("storefront-acme")
  })
  it("falls back to metadata for legacy records", () => {
    expect(
      partnerProjectRef({ metadata: { vercel_project_id: "prj_meta" } }, "vercel")
    ).toBe("prj_meta")
  })
})

describe("hostingProviderForAccount", () => {
  it("resolves creds and builds the matching provider", () => {
    const p = hostingProviderForAccount(
      { provider: "cloudflare", api_config: { token_encrypted: enc("cf-tok"), account_id: "acc_9" } },
      decryptor
    )
    expect(p).toBeInstanceOf(CloudflareWorkersProvider)
  })
})

// ─── S5 providers: Netlify + Render ──────────────────────────────────────────

import { NetlifyProvider } from "../providers/netlify-provider"
import { RenderProvider } from "../providers/render-provider"

describe("resolveAccountCredentials — extra passthrough (S5)", () => {
  it("carries provider-specific non-secret config into `extra`", () => {
    const creds = resolveAccountCredentials(
      {
        token_encrypted: enc("nf-tok"),
        account_id: "acct_1",
        github_installation_id: "999",
        github_repo_id: 12345,
        region: "oregon",
      } as DeploymentApiConfig,
      decryptor
    )
    expect(creds.token).toBe("nf-tok")
    expect(creds.accountId).toBe("acct_1")
    expect(creds.extra).toEqual({
      github_installation_id: "999",
      github_repo_id: "12345",
      region: "oregon",
    })
  })
})

describe("NetlifyProvider", () => {
  const p = new NetlifyProvider({
    token: "nf",
    accountId: "acct_1",
    extra: { github_installation_id: "42" },
  })
  it("has provider name netlify", () => expect(p.provider).toBe("netlify"))
  it("dnsTarget prefers originHost, else <name>.netlify.app", () => {
    expect(p.dnsTarget({ id: "s1", name: "Storefront ACME" })).toBe("storefront-acme.netlify.app")
    expect(p.dnsTarget({ id: "s1", name: "x", originHost: "custom.netlify.app" })).toBe(
      "custom.netlify.app"
    )
  })
  it("requires a token", () => {
    expect(() => new NetlifyProvider({ token: "" } as any)).toThrow(/requires a token/)
  })
  it("createProject requires github_installation_id", async () => {
    const noInstall = new NetlifyProvider({ token: "nf", accountId: "a" })
    await expect(
      noInstall.createProject({ name: "s", gitRepo: "o/r" })
    ).rejects.toThrow(/github_installation_id/)
  })
  it("is built by createHostingProvider('netlify')", () => {
    expect(createHostingProvider("netlify", { token: "t", accountId: "a", extra: { github_installation_id: "1" } }))
      .toBeInstanceOf(NetlifyProvider)
  })
})

describe("RenderProvider", () => {
  const p = new RenderProvider({ token: "rd", extra: { owner_id: "tea_1" } })
  it("has provider name render", () => expect(p.provider).toBe("render"))
  it("dnsTarget prefers originHost, else <name>.onrender.com", () => {
    expect(p.dnsTarget({ id: "s1", name: "Shop One" })).toBe("shop-one.onrender.com")
    expect(p.dnsTarget({ id: "s1", name: "x", originHost: "svc.onrender.com" })).toBe(
      "svc.onrender.com"
    )
  })
  it("createProject requires owner_id", async () => {
    const noOwner = new RenderProvider({ token: "rd" })
    await expect(noOwner.createProject({ name: "s", gitRepo: "o/r" })).rejects.toThrow(/owner_id/)
  })
  it("is built by createHostingProvider('render')", () => {
    expect(createHostingProvider("render", { token: "t", extra: { owner_id: "tea_1" } }))
      .toBeInstanceOf(RenderProvider)
  })
})

// #345 teardown: every adapter can delete its project/site via the provider API,
// so `DELETE /partners/storefront` fully auto-cleans (no dashboard step). A 404
// is treated as already-deleted; any other non-2xx throws.
describe("deleteProject (teardown)", () => {
  const realFetch = global.fetch
  let calls: Array<{ url: string; method?: string }>
  const mockFetch = (status: number) => {
    calls = []
    global.fetch = ((url: any, init: any) => {
      calls.push({ url: String(url), method: init?.method })
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(status >= 400 ? "boom" : ""),
      } as any)
    }) as any
  }
  afterEach(() => {
    global.fetch = realFetch
  })

  const providers = (): Array<[string, { deleteProject?: (id: string) => Promise<void> }]> => [
    ["vercel", new VercelHostingProvider({ token: "v", teamId: "team_1" })],
    ["cloudflare", new CloudflareWorkersProvider({ token: "c", accountId: "acct_1" })],
    ["netlify", new NetlifyProvider({ token: "n", accountId: "a", extra: { github_installation_id: "1" } })],
    ["render", new RenderProvider({ token: "r", extra: { owner_id: "tea_1" } })],
  ]

  it("issues a DELETE and resolves on 200", async () => {
    for (const [name, p] of providers()) {
      mockFetch(200)
      await expect(p.deleteProject!("proj_1")).resolves.toBeUndefined()
      expect(calls[0]?.method).toBe("DELETE")
      expect(calls[0]?.url).toContain("proj_1")
      expect(name).toBeTruthy()
    }
  })

  it("treats 404 as already-deleted (no throw)", async () => {
    for (const [, p] of providers()) {
      mockFetch(404)
      await expect(p.deleteProject!("proj_1")).resolves.toBeUndefined()
    }
  })

  it("throws on other failures (e.g. 500)", async () => {
    for (const [, p] of providers()) {
      mockFetch(500)
      await expect(p.deleteProject!("proj_1")).rejects.toThrow(/deleteProject failed \(500\)/)
    }
  })
})
