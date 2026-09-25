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

      return { partnerId, headers: { Authorization: `Bearer ${login2.data.token}` } }
    }

    const createSizedDesign = async () => {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Luong-like ${Date.now()}`,
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
          size_sets: [
            { size_label: "S", measurements: { chest: 35 } },
            { size_label: "M", measurements: { chest: 37 } },
          ],
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
  })
})
