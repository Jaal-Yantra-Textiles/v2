/**
 * #2596 — capability rates, index-backed search and recipes.
 *
 * Every write goes through the real admin route, so the test proves the
 * route writes the link the search reads (a row without its link exists but
 * no search finds it — the failure this guards against).
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/capability-rates-search
 */
import { PARTNER_MODULE } from "../../src/modules/partner"
import { PARTNER_CAPABILITY_MODULE } from "../../src/modules/partner_capability"
import { backfillCapabilitySearchJob } from "../../src/api/admin/ops/maintenance-jobs/backfill-capability-search-job"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240_000)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("capability rates, search and recipes", () => {
    let headers: Record<string, any>
    let u: string
    const ids: Record<string, string> = {}

    /** Poll a search until `ok` holds — the index updates asynchronously. */
    const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> => {
      let v = await fn()
      for (let i = 0; i < 40 && !ok(v); i++) {
        await sleep(250)
        v = await fn()
      }
      return v
    }

    const search = async (params: Record<string, any>) =>
      (await api.get("/admin/capabilities/search", { ...headers, params })).data.partners.filter(
        (p: any) => p.partner.name.endsWith(u)
      )

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)
      u = Date.now().toString(36)

      const partners = container.resolve(PARTNER_MODULE)
      for (const name of ["Kutch Weavers", "Jaipur Printers", "Ludhiana Stitch", "Dharamshala Studio"]) {
        const p = await partners.createPartners({ name: `${name} ${u}`, handle: `${name.toLowerCase().replace(/\W+/g, "-")}-${u}` })
        ids[name] = p.id
      }

      const sample = (partner: string, body: Record<string, any>) =>
        api.post(`/admin/partners/${ids[partner]}/capabilities`, body, headers)

      await sample("Kutch Weavers", { title: "Kala cotton with weft stripes", technique: "Handloom", material: "kala cotton", product_type: "yardage" })
      await sample("Jaipur Printers", { title: "Two-colour hand block on canvas", technique: "hand block printing", material: "cotton", product_type: "tote" })
      await sample("Ludhiana Stitch", { title: "Canvas tote with gusset", technique: "tailoring", material: "cotton", product_type: "tote" })
      await sample("Dharamshala Studio", { title: "Acrylic hand-painted tote", technique: "hand painted", material: "cotton", product_type: "tote" })
      await sample("Dharamshala Studio", { title: "Lion on merino", technique: "aari", material: "wool", product_type: "shirt" })
    })

    it("maps free-text techniques onto the vocabulary and finds partners by them", async () => {
      const printers = await until(() => search({ technique: "block_print" }), (r) => r.length > 0)
      expect(printers.map((p: any) => p.partner.id)).toEqual([ids["Jaipur Printers"]])
      expect(printers[0].evidence[0].technique).toBe("hand block printing") // partner's words kept
      expect(printers[0].needs_rate).toBe(true) // no rate yet → "ask", never ₹0

      // technique + material must hold on the SAME sample.
      expect(await search({ technique: "hand_painting", material: "wool" })).toEqual([])
      expect((await search({ technique: "hand_embroidery", material: "wool" })).map((p: any) => p.partner.id)).toEqual([ids["Dharamshala Studio"]])

      // Free text reaches the sample's own words.
      expect((await search({ q: "gusset" })).map((p: any) => p.partner.id)).toEqual([ids["Ludhiana Stitch"]])
    })

    it("records rates, guards tenancy, and shows them live in search", async () => {
      const created = await api.post(
        `/admin/partners/${ids["Jaipur Printers"]}/capability-rates`,
        { technique: "block_print", price_low: 120, price_high: 180, min_qty: 50, max_qty: 500, setup_fee: 2500, lead_days: 6, source: "partner_quoted", tax_basis: "gst_exclusive" },
        headers
      )
      expect(created.status).toBe(201)
      const rate = created.data.rate
      expect(rate.unit).toBe("metre") // technique's default unit

      // Coherence: high below low is refused.
      const bad = await api
        .post(`/admin/partners/${ids["Jaipur Printers"]}/capability-rates`, { technique: "block_print", price_low: 200, price_high: 100 }, headers)
        .catch((e) => e.response)
      expect(bad.status).toBe(400)

      // Unknown technique is refused at the edge.
      const unknown = await api
        .post(`/admin/partners/${ids["Jaipur Printers"]}/capability-rates`, { technique: "blockprint", price_low: 1 }, headers)
        .catch((e) => e.response)
      expect(unknown.status).toBe(400)

      // Another partner cannot edit or delete it.
      const foreign = await api
        .post(`/admin/partners/${ids["Kutch Weavers"]}/capability-rates/${rate.id}`, { price_low: 1 }, headers)
        .catch((e) => e.response)
      expect(foreign.status).toBe(404)

      const [match] = await search({ technique: "block_print", quantity: 200 })
      expect(match.rates).toHaveLength(1)
      expect(match.rates[0]).toMatchObject({ price_low: 120, price_high: 180, fits_quantity: true, stale: false })
      expect(match.needs_rate).toBe(false)

      // Outside the quantity band → still "ask".
      const [small] = await search({ technique: "block_print", quantity: 10 })
      expect(small.rates[0].fits_quantity).toBe(false)
      expect(small.needs_rate).toBe(true)

      // A derived rate is a proposal, not a price.
      const derived = await api.post(
        `/admin/partners/${ids["Ludhiana Stitch"]}/capability-rates`,
        { technique: "stitching", price_low: 90, source: "from_past_runs" },
        headers
      )
      expect(derived.data.rate.status).toBe("proposed")

      // A partner with only a rate (no photo) still shows for that technique.
      await api.post(`/admin/partners/${ids["Kutch Weavers"]}/capability-rates`, { technique: "natural_dyeing", price_low: 400, unit: "kg" }, headers)
      expect((await search({ technique: "natural_dyeing" })).map((p: any) => p.partner.id)).toEqual([ids["Kutch Weavers"]])

      // A rate + a material sample on ANOTHER (or no) technique still counts
      // for "technique + material" (GOF on prod, 2026-11-24).
      await getContainer().resolve(PARTNER_CAPABILITY_MODULE).createPartnerCapabilitySamples({
        partner_id: ids["Ludhiana Stitch"], title: `Merino offcuts ${u}`, material: "merino wool",
        source: "admin", captured_at: new Date(),
      })
      await api.post(`/admin/partners/${ids["Ludhiana Stitch"]}/capability-rates`, { technique: "knitting", price_low: 300 }, headers)
      const knitMerino = await search({ technique: "knitting", material: "merino" })
      expect(knitMerino.map((p: any) => p.partner.id)).toEqual([ids["Ludhiana Stitch"]])
      expect(knitMerino[0].partner.name).toBe(`Ludhiana Stitch ${u}`)
      expect(await search({ technique: "knitting", material: "silk" })).toEqual([])

      // Delete → gone.
      await api.delete(`/admin/partners/${ids["Jaipur Printers"]}/capability-rates/${rate.id}`, headers)
      const [after] = await search({ technique: "block_print", quantity: 200 })
      expect(after.rates).toHaveLength(0)
    })

    it("builds a recipe with gaps and counted alternatives", async () => {
      await until(() => search({ technique: "stitching" }), (r) => r.length > 0)
      const res = await api.get("/admin/capabilities/recipe", {
        ...headers,
        params: { steps: "handloom_weaving:kala cotton,block_print,stitching,screen_print", quantity: 200 },
      })
      const steps = res.data.steps.map((s: any) => ({
        ...s,
        partners: s.partners.filter((p: any) => p.partner.name.endsWith(u)),
      }))
      expect(steps.map((s: any) => s.partners.map((p: any) => p.partner.id))).toEqual([
        [ids["Kutch Weavers"]],
        [ids["Jaipur Printers"]],
        [ids["Ludhiana Stitch"]],
        [],
      ])
      // Screen print: nobody here does it, but hand painting is offered and someone does that.
      const screen = steps[3]
      expect(res.data.gaps).toContain("screen_print")
      const hp = screen.alternatives.find((a: any) => a.technique === "hand_painting")
      expect(hp.partner_count).toBeGreaterThanOrEqual(1)

      // A misspelt step is a 400, not a silent "nobody does it".
      const typo = await api
        .get("/admin/capabilities/recipe", { ...headers, params: { steps: "blockprint,stitching" } })
        .catch((e) => e.response)
      expect(typo.status).toBe(400)
    })

    it("backfill makes an old, unlinked sample searchable", async () => {
      const container = getContainer()
      const caps = container.resolve(PARTNER_CAPABILITY_MODULE)
      // Written straight to the module, the way rows existed before #2596.
      const old = await caps.createPartnerCapabilitySamples({
        partner_id: ids["Kutch Weavers"],
        title: `Old shibori stole ${u}`,
        technique: "Shibori",
        source: "admin",
        captured_at: new Date(),
      })
      expect(await search({ technique: "tie_dye" })).toEqual([])

      const dry = await backfillCapabilitySearchJob.run(container, { dry_run: true, params: { partner_id: ids["Kutch Weavers"] } } as any)
      expect(dry.changes.map((c) => c.field).sort()).toEqual(["partner_link", "technique_slug"])
      expect(await search({ technique: "tie_dye" })).toEqual([]) // dry run wrote nothing

      await backfillCapabilitySearchJob.run(container, { dry_run: false, params: { partner_id: ids["Kutch Weavers"] } } as any)
      const found = await until(() => search({ technique: "tie_dye" }), (r) => r.length > 0)
      expect(found[0].evidence.map((e: any) => e.id)).toContain(old.id)

      const again = await backfillCapabilitySearchJob.run(container, { dry_run: true, params: { partner_id: ids["Kutch Weavers"] } } as any)
      expect(again.changes).toEqual([]) // idempotent
    })
  })
})
