import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(240 * 1000)

/**
 * Quoting a design instead of a variant (#1486).
 *
 * ## Why this has to run against a container
 *
 * The pure resolution is covered in `design-lines.unit.spec.ts`. What that
 * cannot see is every part that actually breaks:
 *
 * - a design line reaching `assertVariantsInStore` with `variant_id:
 *   undefined`, which asserts nothing and passes;
 * - `design_id` failing to survive `buildQuoteView` and never landing on the
 *   frozen row, so the quote forgets what the partner picked;
 * - the router matching `/partners/quotes/designs` as a quote id, exactly as it
 *   once nearly did with `readiness`.
 *
 * Every one of those is wiring, and this epic has shipped two defects that
 * lived nowhere else.
 */

setupSharedTestSuite(() => {
  describe("POST /partners/quotes — a line picked as a design (#1486)", () => {
    let seed: QuoteFixture
    /** Linked one-to-one to variant A, so it resolves unambiguously. */
    let backedDesignId: string
    /** No product behind it at all. */
    let sketchDesignId: string

    const container = () => getSharedTestEnv().getContainer()

    const createDesign = async (name: string) => {
      const service: any = container().resolve(DESIGN_MODULE)
      const design = await service.createDesigns({
        name,
        description: `${name} — quote fixture`,
        owner_partner_id: seed.partnerId,
      })
      return (Array.isArray(design) ? design[0] : design).id as string
    }

    beforeAll(async () => {
      await createAdminUser(container())
      seed = await setupQuoteFixture(getSharedTestEnv().api, () => container())

      backedDesignId = await createDesign("Kashida Shawl")
      sketchDesignId = await createDesign("Sketch Only")

      const link: any = container().resolve(ContainerRegistrationKeys.LINK)
      await link.create({
        [DESIGN_MODULE]: { design_id: backedDesignId },
        [Modules.PRODUCT]: { product_variant_id: seed.variantA.id },
      })
    })

    it("mints a quote from a design, priced through the variant behind it", async () => {
      const { api } = getSharedTestEnv()

      const body = mintBody(seed, {
        buyer_email: `design-${seed.unique}@jaalyantra.test`,
        lines: [{ design_id: backedDesignId, quantity: 25 }],
      })

      const res = await api.post("/partners/quotes", body, {
        headers: seed.headers,
      })

      expect(res.status).toBe(201)

      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "partner_quote",
        fields: ["id", "lines.variant_id", "lines.design_id", "lines.quoted_unit_amount"],
        filters: { id: res.data.quote.id },
      })
      const lines = (data?.[0] as any)?.lines ?? []

      expect(lines).toHaveLength(1)
      // Priced through the variant — the existing machinery, untouched.
      expect(lines[0].variant_id).toBe(seed.variantA.id)
      expect(Number(lines[0].quoted_unit_amount)).toBeGreaterThan(0)

      // 🔑 And it remembers WHICH design was picked. Without this the quote
      // shows a SKU for a piece the buyer knows by name, and the provenance of
      // the choice is gone.
      expect(lines[0].design_id).toBe(backedDesignId)
    })

    it("🔴 refuses a design with no product behind it, and writes nothing", async () => {
      const { api } = getSharedTestEnv()

      const before = await countQuotes()

      const err = await api
        .post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `sketch-${seed.unique}@jaalyantra.test`,
            lines: [{ design_id: sketchDesignId, quantity: 10 }],
          }),
          { headers: seed.headers }
        )
        .catch((e: any) => e.response)

      expect(err.status).toBe(400)
      expect(String(err.data?.message ?? "")).toContain("no product behind it")

      // The refusal happens before anything is created — same contract as a
      // variant that does not exist.
      expect(await countQuotes()).toBe(before)
    })

    it("refuses another partner's design the same way it refuses a missing one", async () => {
      // "Not yours" and "not there" must be indistinguishable to someone
      // probing ids, so this asserts the WORDING, not just the failure.
      const { api } = getSharedTestEnv()
      const service: any = container().resolve(DESIGN_MODULE)
      const other = await service.createDesigns({
        name: "Someone else's",
        description: "owned by another partner",
        owner_partner_id: "part_not_ours",
      })
      const otherId = (Array.isArray(other) ? other[0] : other).id

      const err = await api
        .post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `other-${seed.unique}@jaalyantra.test`,
            lines: [{ design_id: otherId, quantity: 10 }],
          }),
          { headers: seed.headers }
        )
        .catch((e: any) => e.response)

      expect(err.status).toBe(400)
      expect(String(err.data?.message ?? "")).toContain("does not exist")
    })

    it("the readiness preflight REPORTS an unquotable design instead of throwing", async () => {
      const { api } = getSharedTestEnv()
      const body = mintBody(seed, {
        lines: [{ design_id: sketchDesignId, quantity: 10 }],
      })

      const res = await api.post(
        "/partners/quotes/readiness",
        {
          lines: body.lines,
          destination_country_code: body.destination_country_code,
          destination_postal_code: body.destination_postal_code,
          currency_code: body.currency_code,
          carrier: body.carrier,
        },
        { headers: seed.headers }
      )

      expect(res.status).toBe(200)
      // 🔴 Not ready. A blocking row under a green tick would let the partner
      // press mint and collect the same error as a 400 — which is the
      // one-error-at-a-time experience this endpoint exists to end.
      expect(res.data.readiness.ready).toBe(false)
      expect(res.data.readiness.blocking_count).toBeGreaterThan(0)
      expect(
        res.data.readiness.issues.map((i: any) => i.code)
      ).toContain("design_unresolved")
    })

    it("GET /partners/quotes/designs lists both, and says which can be quoted", async () => {
      const { api } = getSharedTestEnv()

      // 🔑 Also asserts the router does not match `designs` as a quote id — the
      // same collision `readiness` has a test for.
      const res = await api.get("/partners/quotes/designs?limit=50", {
        headers: seed.headers,
      })

      expect(res.status).toBe(200)
      const byId = new Map(
        (res.data.designs ?? []).map((d: any) => [d.id, d])
      )

      const backed = byId.get(backedDesignId) as any
      expect(backed?.quotable).toBe(true)
      expect(backed?.variant_id).toBe(seed.variantA.id)

      // The unquotable one is LISTED, not hidden — with the reason on it.
      const sketch = byId.get(sketchDesignId) as any
      expect(sketch).toBeTruthy()
      expect(sketch.quotable).toBe(false)
      expect(String(sketch.reason)).toContain("no product behind it")
    })

    const countQuotes = async () => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "partner_quote",
        fields: ["id"],
        filters: { partner_id: seed.partnerId },
      })
      return (data ?? []).length
    }
  })
})
