import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

/**
 * prod 2026-10-13, run prod_run_01M4R17H46GMJG3P2V9Q34KESJ. A partner's
 * completion failed AFTER its consumption logs were written and committed; the
 * retry wrote them again. 4 logs for 2 materials, and — because the partner
 * door dropped `quantity_basis` — none of them ever came off stock.
 */
setupSharedTestSuite(() => {
  describe("Partner run completion — consumption logs roll back, and keep their basis", () => {
    const { api, getContainer } = getSharedTestEnv()

    async function createPartner(unique: number) {
      const email = `rollback-partner-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      let loginRes = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${loginRes.data.token}` }

      const res = await api.post(
        "/partners",
        {
          name: `Rollback Partner ${unique}`,
          handle: `rollback-partner-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)

      loginRes = await api.post("/auth/partner/emailpass", { email, password })
      headers = { Authorization: `Bearer ${loginRes.data.token}` }
      return { partnerId: res.data.partner.id, partnerHeaders: headers }
    }

    async function setup() {
      const container = getContainer()
      const unique = Date.now()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const { partnerId, partnerHeaders } = await createPartner(unique)

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Rollback Design ${unique}`,
          description: "consumption rollback",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      const invRes = await api.post(
        "/admin/inventory-items",
        { title: `Rollback Fabric ${unique}` },
        adminHeaders
      )
      expect(invRes.status).toBe(200)
      const inventoryItemId = invRes.data.inventory_item.id

      return { container, unique, adminHeaders, partnerId, partnerHeaders, designId, inventoryItemId }
    }

    /** Create a run for the partner and walk it to the point of completion. */
    async function readyRun(env: Awaited<ReturnType<typeof setup>>) {
      // A task template is what dispatches the run to the partner.
      const templateName = `rollback-cutting-${env.unique}`
      const tplRes = await api.post(
        "/admin/task-templates",
        {
          name: templateName,
          description: "Cutting",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Rollback Test",
        },
        env.adminHeaders
      )
      expect(tplRes.status).toBe(201)

      const createRes = await api.post(
        `/admin/designs/${env.designId}/production-runs`,
        { assignments: [{ partner_id: env.partnerId, quantity: 2, template_names: [templateName] }] },
        env.adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.children[0].id
      const h = { headers: env.partnerHeaders }
      for (const step of ["accept", "start", "finish"]) {
        await api.post(`/partners/production-runs/${runId}/${step}`, {}, h).catch((e: any) => {
          throw new Error(`${step}: ${e.response?.status} ${JSON.stringify(e.response?.data)}`)
        })
      }
      return runId
    }

    const logsForRun = async (container: any, runId: string) => {
      const service: any = container.resolve("consumption_log")
      return (await service.listConsumptionLogs({ production_run_id: runId })) as any[]
    }

    it("deletes the consumption logs a failed completion wrote", async () => {
      const env = await setup()

      /**
       * The simplest reliable failure AFTER the logs are written: the design
       * carries two variants and the run names neither, so the stock step
       * refuses to pick one (#1872) — after the run was marked completed and
       * the consumptions logged.
       */
      const productService: any = env.container.resolve(Modules.PRODUCT)
      const [product] = await productService.createProducts([
        {
          title: `Rollback Product ${env.unique}`,
          options: [{ title: "Size", values: ["S", "M"] }],
          variants: [
            { title: "S", options: { Size: "S" } },
            { title: "M", options: { Size: "M" } },
          ],
        },
      ])
      const full = await productService.retrieveProduct(product.id, { relations: ["variants"] })
      const link: any = env.container.resolve(ContainerRegistrationKeys.LINK)
      for (const v of full.variants) {
        await link.create({
          design: { design_id: env.designId },
          [Modules.PRODUCT]: { product_variant_id: v.id },
        })
      }

      const runId = await readyRun(env)

      const res = await api
        .post(
          `/partners/production-runs/${runId}/complete`,
          {
            produced_quantity: 2,
            consumptions: [
              { inventory_item_id: env.inventoryItemId, quantity: 3, unit_of_measure: "Meter", quantity_basis: "total" },
              { inventory_item_id: env.inventoryItemId, quantity: 1, unit_of_measure: "Meter", quantity_basis: "total" },
            ],
          },
          { headers: env.partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(res.data)).toContain("does not say which")

      // The completion rolled back, so its logs must be gone too.
      expect(await logsForRun(env.container, runId)).toHaveLength(0)

      // The run itself was rolled back too — the retry has a run to complete.
      const runService: any = env.container.resolve("production_runs")
      const run = await runService.retrieveProductionRun(runId)
      expect(run.status).not.toBe("completed")
    })

    it("keeps quantity_basis from the partner's completion on the log, and commits it", async () => {
      const env = await setup()
      const runId = await readyRun(env)

      const res = await api
        .post(
          `/partners/production-runs/${runId}/complete`,
          {
            produced_quantity: 2,
            consumptions: [
              { inventory_item_id: env.inventoryItemId, quantity: 3, unit_of_measure: "Meter", quantity_basis: "total" },
            ],
          },
          { headers: env.partnerHeaders }
        )
        .catch((e: any) => e.response)
      expect({ status: res.status, data: res.status === 200 ? null : res.data }).toEqual({
        status: 200,
        data: null,
      })
      expect(res.data.consumptions_logged).toBe(1)

      const logs = await logsForRun(env.container, runId)
      expect(logs).toHaveLength(1)
      expect(logs[0].quantity_basis).toBe("total")
      expect(logs[0].quantity).toBe(3)
      expect(logs[0].is_committed).toBe(true)
    })
  })
})
