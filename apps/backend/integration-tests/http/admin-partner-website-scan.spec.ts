/**
 * Admin API — scan a partner's website into the capability library (#2249).
 *
 * The contracts worth pinning:
 *   - a SCAN files nothing: it stores proposals, and the library stays empty
 *   - a COMMIT files only what the scan proposed, stamped source='website',
 *     with the site's publish date as captured_at and the photo COPIED into
 *     media (a media_file id, not the partner's URL)
 *   - committing twice cannot duplicate
 *   - a scan is reachable only through its partner
 *   - an internal address is refused before any request is made
 *   - knowledge is append-only, admin-visible, and can hang off a sample
 *
 * The model is switched off (WEBSITE_SCAN_MODEL=off) so this never depends on
 * a live provider; the fallback grouping is what gets committed. The fixture
 * site is served from 127.0.0.1, which the SSRF guard allows ONLY under
 * NODE_ENV=test with WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS=true.
 */
import http from "node:http"
import type { AddressInfo } from "node:net"

import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(120 * 1000)

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin Partners API — website scan", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerId: string
    let otherPartnerId: string
    let server: http.Server
    let site: string
    const OLD = {
      hatch: process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS,
      model: process.env.WEBSITE_SCAN_MODEL,
    }

    beforeAll(async () => {
      process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = "true"
      process.env.WEBSITE_SCAN_MODEL = "off"
      server = http.createServer((req, res) => {
        if (req.url?.startsWith("/products.json")) {
          res.writeHead(200, { "content-type": "application/json" })
          return res.end(
            JSON.stringify({
              products: [
                { title: "Kala Cotton Stole Rust", handle: "stole-rust", product_type: "Stole", tags: ["kala cotton"], body_html: "<p>Handwoven in Kutch</p>", images: [{ src: "/img.png" }], published_at: "2025-08-02T00:00:00Z" },
                { title: "Kala Cotton Stole Indigo", handle: "stole-indigo", product_type: "Stole", tags: [], body_html: "", images: [], published_at: "2025-09-01T00:00:00Z" },
                { title: "Cheque Yardage", handle: "cheque", product_type: "Fabric", tags: [], body_html: "", images: [], published_at: null },
              ],
            })
          )
        }
        if (req.url === "/img.png") {
          res.writeHead(200, { "content-type": "image/png" })
          return res.end(PNG)
        }
        if (req.url === "/") {
          res.writeHead(200, { "content-type": "text/html" })
          return res.end("<html><body><p>Organic kala cotton handloom from Kutch.</p></body></html>")
        }
        res.writeHead(404)
        res.end()
      })
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
      site = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    })

    afterAll(async () => {
      process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = OLD.hatch
      process.env.WEBSITE_SCAN_MODEL = OLD.model
      await new Promise((r) => server.close(r))
    })

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      const partnerService: any = container.resolve(PARTNER_MODULE)
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      partnerId = (
        await partnerService.createPartners({ name: `Scan ${unique}`, handle: `scan-${unique}` })
      ).id
      otherPartnerId = (
        await partnerService.createPartners({ name: `Scan Other ${unique}`, handle: `scan-other-${unique}` })
      ).id
    })

    const scan = (id = partnerId, url = site) =>
      api.post(`/admin/partners/${id}/capabilities/scan`, { url }, adminHeaders)

    const list = (id = partnerId) =>
      api.get(`/admin/partners/${id}/capabilities`, adminHeaders)

    it("scans into PROPOSALS and files nothing", async () => {
      const res = await scan()
      expect(res.status).toBe(201)
      const s = res.data.scan
      expect(s.id).toEqual(expect.stringContaining("pcscan"))
      expect(s.platform).toBe("shopify")
      expect(s.status).toBe("proposed")
      expect(s.proposal.grouped_by).toBe("fallback")
      expect(s.proposal.samples.map((p: any) => [p.key, p.title, p.evidence.length])).toEqual([
        ["s1", "Stole", 2],
        ["s2", "Fabric", 1],
      ])
      expect((await list()).data.count).toBe(0)
    })

    it("commits by key: source=website, the site's date, and the photo COPIED into media", async () => {
      const scanId = (await scan()).data.scan.id
      const res = await api.post(
        `/admin/partners/${partnerId}/capabilities/scans/${scanId}/commit`,
        { sample_keys: ["s1"] },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.warnings).toEqual([])
      expect(res.data.samples).toHaveLength(1)

      const [sample] = (await list()).data.samples
      expect(sample.title).toBe("Stole")
      expect(sample.product_type).toBe("stole")
      expect(sample.source).toBe("website")
      expect(sample.source_url).toBe(`${site}products/stole-rust`)
      // earliest publish date among the evidence, not "now"
      expect(new Date(sample.captured_at).toISOString()).toBe("2025-08-02T00:00:00.000Z")
      expect(sample.metadata.captured_at_defaulted).toBe(false)
      // the evidence is OURS now — a media_file id, not the partner's URL
      expect(sample.media_file_ids).toHaveLength(1)
      expect(sample.media_file_ids[0]).not.toContain("127.0.0.1")
      expect(sample.media?.[0]?.url).toBeTruthy()
    })

    it("cannot duplicate: a second commit of the same key files nothing", async () => {
      const scanId = (await scan()).data.scan.id
      const commit = () =>
        api.post(`/admin/partners/${partnerId}/capabilities/scans/${scanId}/commit`, {}, adminHeaders)
      const first = await commit()
      expect(first.data.samples).toHaveLength(2)
      const second = await commit()
      expect(second.data.samples).toHaveLength(0)
      expect(second.data.skipped_already_committed.sort()).toEqual(["s1", "s2"])
      expect((await list()).data.count).toBe(2)

      const read = await api.get(`/admin/partners/${partnerId}/capabilities/scans/${scanId}`, adminHeaders)
      expect(read.data.scan.status).toBe("committed")
      expect(Object.keys(read.data.scan.committed_keys).sort()).toEqual(["s1", "s2"])
    })

    it("defaults captured_at to the scan date — and SAYS so — when the site gave none", async () => {
      const scanId = (await scan()).data.scan.id
      await api.post(`/admin/partners/${partnerId}/capabilities/scans/${scanId}/commit`, { sample_keys: ["s2"] }, adminHeaders)
      const [sample] = (await list()).data.samples
      expect(sample.title).toBe("Fabric")
      expect(sample.metadata.captured_at_defaulted).toBe(true)
    })

    it("refuses an unknown key rather than committing a subset silently", async () => {
      const scanId = (await scan()).data.scan.id
      const res = await api
        .post(`/admin/partners/${partnerId}/capabilities/scans/${scanId}/commit`, { sample_keys: ["s1", "s9"] }, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(res.data.message).toMatch(/s9/)
      expect((await list()).data.count).toBe(0)
    })

    it("reaches a scan only through its partner", async () => {
      const scanId = (await scan()).data.scan.id
      const res = await api
        .post(`/admin/partners/${otherPartnerId}/capabilities/scans/${scanId}/commit`, {}, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
      expect((await list(otherPartnerId)).data.count).toBe(0)
      expect((await list()).data.count).toBe(0)
    })

    it("refuses an internal address before fetching anything", async () => {
      const res = await scan(partnerId, "http://169.254.169.254/latest/meta-data/").catch(
        (e: any) => e.response
      )
      expect(res.status).toBe(400)
      expect(res.data.message).toMatch(/private or reserved/)
    })

    it("appends knowledge — to a sample and partner-wide — and lists it for admins", async () => {
      const scanId = (await scan()).data.scan.id
      await api.post(`/admin/partners/${partnerId}/capabilities/scans/${scanId}/commit`, { sample_keys: ["s1"] }, adminHeaders)
      const [sample] = (await list()).data.samples

      const k1 = await api.post(
        `/admin/partners/${partnerId}/capabilities/knowledge`,
        { fact: "Stoles take about 10 days", sample_id: sample.id, observed_at: "2026-09-01" },
        adminHeaders
      )
      expect(k1.status).toBe(201)
      expect(k1.data.knowledge.source).toBe("admin")
      expect(k1.data.observed_at_defaulted).toBe(false)
      await api.post(`/admin/partners/${partnerId}/capabilities/knowledge`, { fact: "Natural dyes only" }, adminHeaders)

      const res = await list()
      expect(res.data.samples[0].knowledge.map((k: any) => k.fact)).toEqual(["Stoles take about 10 days"])
      expect(res.data.partner_knowledge.map((k: any) => k.fact)).toEqual(["Natural dyes only"])
    })

    it("will not hang knowledge on another partner's sample", async () => {
      const scanId = (await scan()).data.scan.id
      await api.post(`/admin/partners/${partnerId}/capabilities/scans/${scanId}/commit`, { sample_keys: ["s1"] }, adminHeaders)
      const [sample] = (await list()).data.samples
      const res = await api
        .post(`/admin/partners/${otherPartnerId}/capabilities/knowledge`, { fact: "x", sample_id: sample.id }, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })
  })
})
