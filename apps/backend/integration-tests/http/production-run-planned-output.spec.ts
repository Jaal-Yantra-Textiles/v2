import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PARTNER_MODULE } from "../../src/modules/partner"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

/**
 * #2271 — a run plans its output per size, and the partner confirms what was
 * made.
 *
 * The shape this exists for is the Luong Shirt run on prod: a design stating S
 * and M, a run of 3, and nothing anywhere saying which sizes were made.
 */
setupSharedTestSuite(() => {
  describe("Production run planned/produced output per size (#2271)", () => {
    let adminHeaders: any
    const { api, getContainer } = getSharedTestEnv()

    const registerPartner = async (label: string) => {
      const unique = Date.now()
      const email = `run-output-${label}-${unique}@medusa-test.com`
      await api.post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const login = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const partnerRes = await api.post(
        "/partners",
        {
          name: `RunOutput ${label} ${unique}`,
          handle: `run-output-${label}-${unique}`,
          admin: { email, first_name: "Partner", last_name: label },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      expect(partnerRes.status).toBe(200)
      const partnerId = partnerRes.data.partner.id
      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      // Completion refuses a partner with nowhere to bank goods (#2053).
      const locRes = await api.post(
        "/admin/stock-locations",
        { name: `RunOutput Warehouse ${unique}` },
        adminHeaders
      )
      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create({
        [PARTNER_MODULE]: { partner_id: partnerId },
        [Modules.STOCK_LOCATION]: { stock_location_id: locRes.data.stock_location.id },
      })

      return {
        partnerId,
        locationId: locRes.data.stock_location.id as string,
        headers: { Authorization: `Bearer ${login2.data.token}` },
      }
    }

    const createSizedDesign = async (sized = true) => {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Luong-like ${Date.now()}`,
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
          // A price for the draft product minted at completion (#2271).
          estimated_cost: 400,
          ...(sized
            ? {
                size_sets: [
                  { size_label: "S", measurements: { chest: 35 } },
                  { size_label: "M", measurements: { chest: 37 } },
                ],
              }
            : {}),
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    /** accept → start → finish, as the partner. */
    const walkToFinished = async (runId: string, headers: any) => {
      const service = getContainer().resolve("production_runs") as any
      await service.updateProductionRuns({ id: runId, status: "sent_to_partner" })
      for (const step of ["accept", "start", "finish"]) {
        const r = await api
          .post(`/partners/production-runs/${runId}/${step}`, {}, { headers })
          .catch((e: any) => e.response)
        if (r.status !== 200) {
          throw new Error(`${step} failed ${r.status}: ${JSON.stringify(r.data)}`)
        }
      }
    }

    const readRun = async (runId: string) => {
      const service = getContainer().resolve("production_runs") as any
      return service.retrieveProductionRun(runId)
    }

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("records the plan on the run, and a child covering the same total inherits it", async () => {
      const designId = await createSizedDesign()
      const { partnerId } = await registerPartner("plan")

      const res = await api
        .post(
          `/admin/designs/${designId}/production-runs`,
          {
            quantity: 3,
            planned_output: [
              { size_label: "S", quantity: 1 },
              { size_label: "M", quantity: 2 },
            ],
            assignments: [{ partner_id: partnerId, quantity: 3 }],
          },
          adminHeaders
        )
        .catch((e: any) => e.response)
      if (![200, 201].includes(res.status)) {
        throw new Error(`Create failed ${res.status}: ${JSON.stringify(res.data)}`)
      }

      const service = getContainer().resolve("production_runs") as any
      const [parent] = await service.listProductionRuns({ design_id: designId, parent_run_id: null })
      const [child] = await service.listProductionRuns({ design_id: designId, partner_id: partnerId })

      const expected = [
        { size_label: "S", color: null, quantity: 1 },
        { size_label: "M", color: null, quantity: 2 },
      ]
      expect(parent.planned_output).toEqual(expected)
      expect(child.parent_run_id).toBe(parent.id)
      expect(child.planned_output).toEqual(expected)
    })

    it("refuses a plan naming a size the design does not have", async () => {
      const designId = await createSizedDesign()
      const res = await api
        .post(
          "/admin/production-runs",
          {
            design_id: designId,
            quantity: 3,
            planned_output: [{ size_label: "XL", quantity: 3 }],
          },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(res.data)).toContain("XL")
    })

    it("asks the partner which sizes were made, then records the confirmed split", async () => {
      const designId = await createSizedDesign()
      const { partnerId, headers } = await registerPartner("confirm")

      const runRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, partner_id: partnerId, quantity: 3 },
        adminHeaders
      )
      const runId = runRes.data.production_run.id
      await walkToFinished(runId, headers)

      // No plan, two sizes, no split: refused, never guessed.
      const refused = await api
        .post(
          `/partners/production-runs/${runId}/complete`,
          { produced_quantity: 3 },
          { headers }
        )
        .catch((e: any) => e.response)
      expect(refused.status).toBe(400)
      expect(JSON.stringify(refused.data)).toContain("S, M")
      expect((await readRun(runId)).status).not.toBe("completed")

      // A split that does not add up to the good pieces is refused too.
      const short = await api
        .post(
          `/partners/production-runs/${runId}/complete`,
          { produced_quantity: 3, produced_output: [{ size_label: "M", quantity: 2 }] },
          { headers }
        )
        .catch((e: any) => e.response)
      expect(short.status).toBe(400)

      const ok = await api
        .post(
          `/partners/production-runs/${runId}/complete`,
          {
            produced_quantity: 3,
            produced_output: [
              { size_label: "S", quantity: 2 },
              { size_label: "M", quantity: 1 },
            ],
          },
          { headers }
        )
        .catch((e: any) => e.response)
      if (ok.status !== 200) {
        throw new Error(`Complete failed ${ok.status}: ${JSON.stringify(ok.data)}`)
      }

      const run = await readRun(runId)
      expect(run.status).toBe("completed")
      expect(run.produced_output).toEqual([
        { size_label: "S", color: null, quantity: 2 },
        { size_label: "M", color: null, quantity: 1 },
      ])
    })

    it("takes the plan when the partner confirms nothing and the plan adds up", async () => {
      const designId = await createSizedDesign()
      const { partnerId, headers } = await registerPartner("planned")

      const runRes = await api.post(
        "/admin/production-runs",
        {
          design_id: designId,
          partner_id: partnerId,
          quantity: 3,
          planned_output: [
            { size_label: "S", quantity: 1 },
            { size_label: "M", quantity: 2 },
          ],
        },
        adminHeaders
      )
      const runId = runRes.data.production_run.id
      await walkToFinished(runId, headers)

      const ok = await api
        .post(`/partners/production-runs/${runId}/complete`, { produced_quantity: 3 }, { headers })
        .catch((e: any) => e.response)
      if (ok.status !== 200) {
        throw new Error(`Complete failed ${ok.status}: ${JSON.stringify(ok.data)}`)
      }
      expect((await readRun(runId)).produced_output).toEqual([
        { size_label: "S", color: null, quantity: 1 },
        { size_label: "M", color: null, quantity: 2 },
      ])
    })
    /** Stock levels of a design's variants at a location, keyed by variant title. */
    const levelsByVariant = async (designId: string, locationId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: links } = await query.graph({
        entity: "design_product_variant",
        filters: { design_id: designId },
        fields: ["product_variant_id"],
      })
      const variantIds = links.map((l: any) => l.product_variant_id)
      const { data: variants } = await query.graph({
        entity: "product_variant",
        filters: { id: variantIds },
        fields: ["id", "title", "product_id", "options.value", "options.option.title", "inventory_items.inventory_item_id"],
      })
      const inventory = getContainer().resolve(Modules.INVENTORY) as any
      const out: Record<string, number> = {}
      for (const v of variants) {
        const size =
          (v.options || []).find((o: any) => o.option?.title === "Size")?.value ?? "(none)"
        const itemId = v.inventory_items?.[0]?.inventory_item_id
        const [level] = itemId
          ? await inventory.listInventoryLevels({ inventory_item_id: itemId, location_id: locationId })
          : []
        out[size] = level?.stocked_quantity ?? 0
      }
      return { levels: out, productIds: Array.from(new Set(variants.map((v: any) => v.product_id))) }
    }

    const completeWithSplit = async (
      runId: string,
      headers: any,
      produced: number,
      produced_output?: any[]
    ) => {
      const r = await api
        .post(
          `/partners/production-runs/${runId}/complete`,
          { produced_quantity: produced, ...(produced_output ? { produced_output } : {}) },
          { headers }
        )
        .catch((e: any) => e.response)
      if (r.status !== 200) {
        throw new Error(`Complete failed ${r.status}: ${JSON.stringify(r.data)}`)
      }
    }

    /**
     * The Luong Shirt case end to end: a design stating S and M with NO product.
     * Completion mints a draft, adds a Size axis, creates S and M, and banks
     * each size at the partner's warehouse.
     */
    it("mints a draft, creates a variant per size, and banks each size", async () => {
      const designId = await createSizedDesign()
      const { partnerId, locationId, headers } = await registerPartner("sizes")

      const runRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, partner_id: partnerId, quantity: 3 },
        adminHeaders
      )
      const runId = runRes.data.production_run.id
      await walkToFinished(runId, headers)
      await completeWithSplit(runId, headers, 3, [
        { size_label: "S", quantity: 1 },
        { size_label: "M", quantity: 2 },
      ])

      const { levels, productIds } = await levelsByVariant(designId, locationId)
      expect(productIds).toHaveLength(1)
      expect(levels).toEqual({ "Made to order": 0, S: 1, M: 2 })

      const product = (
        await api.get(`/admin/products/${productIds[0]}`, adminHeaders)
      ).data.product
      expect(product.status).toBe("draft")

      const run = await readRun(runId)
      expect(run.stocked_quantity).toBe(3)
      expect(run.stocked_at_location_id).toBe(locationId)
      expect(run.product_id).toBe(productIds[0])

      // A second run reuses S and M — no duplicate variants.
      const run2 = await api.post(
        "/admin/production-runs",
        { design_id: designId, partner_id: partnerId, quantity: 2 },
        adminHeaders
      )
      const run2Id = run2.data.production_run.id
      await walkToFinished(run2Id, headers)
      await completeWithSplit(run2Id, headers, 2, [{ size_label: "S", quantity: 2 }])

      const after = await levelsByVariant(designId, locationId)
      expect(after.levels).toEqual({ "Made to order": 0, S: 3, M: 2 })
    })

    /** Alpha 60 Top: no sizes, no product. One draft, one unit, no axis. */
    it("mints a draft and banks a sizeless run onto its only variant", async () => {
      const designId = await createSizedDesign(false)
      const { partnerId, locationId, headers } = await registerPartner("nosize")

      const runRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, partner_id: partnerId, quantity: 1 },
        adminHeaders
      )
      const runId = runRes.data.production_run.id
      await walkToFinished(runId, headers)
      await completeWithSplit(runId, headers, 1)

      const { levels, productIds } = await levelsByVariant(designId, locationId)
      expect(productIds).toHaveLength(1)
      expect(levels).toEqual({ "(none)": 1 })

      const run = await readRun(runId)
      expect(run.stocked_quantity).toBe(1)
      expect(run.variant_id).toBeTruthy()
    })
    /**
     * 🔴 The legacy single-variant path, banking onto a level that ALREADY
     * exists. `updateInventoryLevels(level.id, data)` threw "Item undefined is
     * not stocked at location undefined", so the second completed run of any
     * design at the same warehouse failed. Found by #2271's per-size test.
     */
    it("banks a second run onto an existing level (legacy path)", async () => {
      const designId = await createSizedDesign(false)
      const approve = await api
        .post(`/admin/designs/${designId}/approve`, {}, adminHeaders)
        .catch((e: any) => e.response)
      if (approve.status !== 200) {
        throw new Error(`Approve failed ${approve.status}: ${JSON.stringify(approve.data)}`)
      }
      const { partnerId, locationId, headers } = await registerPartner("legacy")

      for (const qty of [2, 3]) {
        const runRes = await api.post(
          "/admin/production-runs",
          { design_id: designId, partner_id: partnerId, quantity: qty },
          adminHeaders
        )
        const runId = runRes.data.production_run.id
        await walkToFinished(runId, headers)
        await completeWithSplit(runId, headers, qty)
      }

      const { levels } = await levelsByVariant(designId, locationId)
      expect(levels).toEqual({ "(none)": 5 })
    })
    /**
     * The Luong Shirt state on prod: a run completed while the design had no
     * product (nothing banked), then approval minted a SIZELESS product. The
     * repair job adds S and M and banks 1 + 2 at the partner's warehouse.
     */
    it("bank-unstocked-run: previews without writing, then banks S and M", async () => {
      const designId = await createSizedDesign()
      const { partnerId, locationId } = await registerPartner("repair")

      const runRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, partner_id: partnerId, quantity: 3 },
        adminHeaders
      )
      const runId = runRes.data.production_run.id
      const service = getContainer().resolve("production_runs") as any
      // Completed the old way: no stock, no split.
      await service.updateProductionRuns({
        id: runId,
        status: "completed",
        completed_at: new Date(),
        produced_quantity: 3,
      })
      const approve = await api
        .post(`/admin/designs/${designId}/approve`, {}, adminHeaders)
        .catch((e: any) => e.response)
      expect(approve.status).toBe(200)

      const runJob = (body: any) =>
        api
          .post(`/admin/ops/maintenance-jobs/bank-unstocked-run/run`, body, adminHeaders)
          .catch((e: any) => e.response)

      // No split on a two-size run: refused, never guessed.
      const noSplit = await runJob({ dry_run: true, params: { run_id: runId } })
      expect(noSplit.status).toBeGreaterThanOrEqual(400)

      const preview = await runJob({
        dry_run: true,
        params: { run_id: runId, produced_output: "S:1,M:2" },
      })
      expect(preview.status).toBe(200)
      expect(preview.data.result.applied).toBe(false)
      expect((await readRun(runId)).stocked_at).toBeNull()
      expect((await levelsByVariant(designId, locationId)).levels).toEqual({ "(none)": 0 })

      const apply = await runJob({
        dry_run: false,
        params: { run_id: runId, produced_output: "S:1,M:2" },
      })
      if (apply.status !== 200) {
        throw new Error(`apply failed ${apply.status}: ${JSON.stringify(apply.data)}`)
      }
      expect((await levelsByVariant(designId, locationId)).levels).toEqual({
        "Made to order": 0,
        S: 1,
        M: 2,
      })
      const run = await readRun(runId)
      expect(run.stocked_quantity).toBe(3)
      expect(run.produced_output).toEqual([
        { size_label: "S", color: null, quantity: 1 },
        { size_label: "M", color: null, quantity: 2 },
      ])

      // A second apply is refused — the run is already banked.
      const again = await runJob({
        dry_run: false,
        params: { run_id: runId, produced_output: "S:1,M:2" },
      })
      expect(again.status).toBeGreaterThanOrEqual(400)
    })
  })
})
