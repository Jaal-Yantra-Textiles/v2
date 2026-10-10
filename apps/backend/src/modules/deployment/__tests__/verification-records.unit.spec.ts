/**
 * Vercel domain-verification TXT records (2026-10-10, shramdaan.cicilabel.com
 * stayed unverified with HTTPS dead).
 *
 * Pinned: every `*.cicilabel.com` storefront's challenge lives at the SAME
 * name, `_vercel.cicilabel.com` — so a new challenge is ADDED beside the
 * others and an existing sibling is never edited; and the app container's
 * credentials are used, not the env token.
 */
import DeploymentService, { normalizeDnsContent } from "../service"

const make = (existing: Array<{ id: string; content: string }>) => {
  const svc: any = Object.create(DeploymentService.prototype)
  svc.log = jest.fn()
  svc.isCloudflareConfigured = jest.fn(async () => true)
  svc.cloudflareCreds = jest.fn(async (c: any) => ({ token: "t", zoneId: "z", fromContainer: !!c }))
  svc.listDnsRecords = jest.fn(async () => existing.map((e) => ({ ...e, type: "TXT", name: "_vercel.cicilabel.com", proxied: false })))
  svc.createDnsRecord = jest.fn(async () => ({ id: "new" }))
  svc.updateDnsRecord = jest.fn(async () => ({ id: "upd" }))
  return svc
}

const CHALLENGE = {
  type: "TXT",
  domain: "_vercel.cicilabel.com",
  value: "vc-domain-verify=shramdaan.cicilabel.com,eda2facb548e16d185e4",
}

describe("createVercelVerificationRecords", () => {
  it("🔴 ADDS a TXT beside another store's challenge, never overwriting it", async () => {
    const svc = make([{ id: "pml", content: "vc-domain-verify=pml.cicilabel.com,abc" }])
    const out = await svc.createVercelVerificationRecords([CHALLENGE], { container: true })
    expect(svc.updateDnsRecord).not.toHaveBeenCalled()
    expect(svc.createDnsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TXT", name: CHALLENGE.domain, content: CHALLENGE.value }),
      expect.anything()
    )
    expect(out).toEqual([{ domain: CHALLENGE.domain, action: "created", id: "new" }])
  })

  it("leaves an identical challenge alone, even when Cloudflare returns it quoted", async () => {
    const svc = make([{ id: "same", content: `"${CHALLENGE.value}"` }])
    const out = await svc.createVercelVerificationRecords([CHALLENGE], {})
    expect(svc.createDnsRecord).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ action: "exists", id: "same" })
  })

  it("resolves credentials from the app container it is given", async () => {
    const svc = make([])
    const container = { resolve: jest.fn() }
    await svc.createVercelVerificationRecords([CHALLENGE], container)
    expect(svc.cloudflareCreds).toHaveBeenCalledWith(container)
    expect(svc.isCloudflareConfigured).toHaveBeenCalledWith(container)
  })

  it("normalizes quoted DNS content", () => {
    expect(normalizeDnsContent('"a=b"')).toBe("a=b")
    expect(normalizeDnsContent(" a=b ")).toBe("a=b")
  })
})
