import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PARTNER_MODULE } from "../../src/modules/partner"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("Production Run Completion → Inventory Stocking", () => {
    let adminHeaders: any
    let designId: string

    const { api, getContainer } = getSharedTestEnv()

    const registerPartner = async (label: string) => {
      const unique = Date.now()
      const email = `inv-stock-${label}-${unique}@medusa-test.com`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      const login = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers1 = { Authorization: `Bearer ${login.data.token}` }

      const partnerRes = await api
        .post(
          "/partners",
          {
            name: `InvStock ${label} ${unique}`,
            handle: `inv-stock-${label}-${unique}`,
            admin: { email, first_name: "Partner", last_name: label },
          },
          { headers: headers1 }
        )
        .catch((e: any) => e.response)

      expect(partnerRes.status).toBe(200)
      const partnerId = partnerRes.data.partner.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers2 = { Authorization: `Bearer ${login2.data.token}` }

      return { partnerId, headers: headers2 }
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Create email templates used by workflows (ignore if already exists)
      const emailTemplates = [
        {
          name: "Admin Partner Created",
          template_key: "partner-created-from-admin",
          subject: "You're invited to set up your partner account at {{partner_name}}",
          html_content: `<div>Partner {{partner_name}} created. Temp password: {{temp_password}}</div>`,
          from: "partners@jaalyantra.com",
          variables: {
            partner_name: "Partner display name",
            temp_password: "Temporary password issued to the partner admin",
          },
          template_type: "email",
        },
        {
          name: "Design Production Started",
          template_key: "design-production-started",
          subject: "Production started for {{design_name}}",
          html_content: "<div>Production for {{design_name}} has started.</div>",
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
        {
          name: "Design Production Completed",
          template_key: "design-production-completed",
          subject: "Production completed for {{design_name}}",
          html_content: "<div>Production for {{design_name}} is complete.</div>",
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
      ]
      for (const tpl of emailTemplates) {
        try {
          await api.post("/admin/email-templates", tpl, adminHeaders)
        } catch (e: any) {
          // ok
        }
      }
    })

    it("should create inventory item with manage_inventory:true when design is approved", async () => {
      // Create a design
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `InvStock Design ${Date.now()}`,
          description: "Test inventory stocking",
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
          estimated_cost: 100,
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      designId = designRes.data.design.id

      // Approve → creates product + variant + inventory item
      const approveRes = await api
        .post(`/admin/designs/${designId}/approve`, {}, adminHeaders)
        .catch((e: any) => e.response)

      if (approveRes.status !== 200) {
        throw new Error(`Approve failed ${approveRes.status}: ${JSON.stringify(approveRes.data)}`)
      }
      expect(approveRes.data.product_id).toBeDefined()
      expect(approveRes.data.variant_id).toBeDefined()

      const variantId = approveRes.data.variant_id

      // Verify the variant has manage_inventory: true
      const productRes = await api.get(
        `/admin/products/${approveRes.data.product_id}?fields=*variants`,
        adminHeaders
      )
      const variant = productRes.data.product.variants?.find(
        (v: any) => v.id === variantId
      )
      expect(variant).toBeDefined()
      expect(variant.manage_inventory).toBe(true)

      // Verify an inventory item was auto-created and linked to the variant
      const invRes = await api.get(
        `/admin/inventory-items?sku=${variant.sku}`,
        adminHeaders
      )
      expect(invRes.data.inventory_items.length).toBeGreaterThan(0)
    })

    it("should stock inventory at partner location when production run completes", async () => {
      // Create a fresh design for this test
      const designRes2 = await api.post(
        "/admin/designs",
        {
          name: `InvStock Run Design ${Date.now()}`,
          description: "Test production run inventory stocking",
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
          estimated_cost: 200,
        },
        adminHeaders
      )
      expect(designRes2.status).toBe(201)
      const runDesignId = designRes2.data.design.id

      // Approve it first to create product + variant + inventory item
      const approveRes = await api
        .post(`/admin/designs/${runDesignId}/approve`, {}, adminHeaders)
        .catch((e: any) => e.response)

      if (approveRes.status !== 200) {
        throw new Error(`Approve failed ${approveRes.status}: ${JSON.stringify(approveRes.data)}`)
      }
      // Use runDesignId below instead of designId

      const { partnerId, headers: partnerHeaders } = await registerPartner("stock")

      // Create stock location for partner
      const locRes = await api.post(
        "/admin/stock-locations",
        { name: `Partner Warehouse ${Date.now()}` },
        adminHeaders
      )
      expect(locRes.status).toBe(200)
      const stockLocationId = locRes.data.stock_location.id

      /**
       * 🔴 Link the warehouse to the PARTNER.
       *
       * This used to link it to `stores[0].default_sales_channel_id` — the
       * PLATFORM store's channel — on the assumption that
       * `resolvePartnerLocationStep` would find it from there. It cannot: the
       * partner registered above has no store, so the
       * `partner → stores[0] → channel → locations[0]` walk died at hop one and
       * returned undefined. Nothing was ever stocked, and the assertion at the
       * bottom of this test was guarded by `if (location_levels.length > 0)` —
       * so it never ran, and the test passed having verified nothing. #2053
       */
      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create({
        [PARTNER_MODULE]: { partner_id: partnerId },
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
      })

      // Create production run
      const runRes = await api
        .post(
          "/admin/production-runs",
          {
            design_id: runDesignId,
            partner_id: partnerId,
            quantity: 10,
            run_type: "production",
          },
          adminHeaders
        )
        .catch((e: any) => e.response)

      if (![200, 201].includes(runRes.status)) {
        throw new Error(`Create run failed ${runRes.status}: ${JSON.stringify(runRes.data)}`)
      }
      const runId = runRes.data.production_run.id

      // Move through the lifecycle: accept → start → finish → complete
      // First update status to sent_to_partner (since we skip the full dispatch workflow)
      const container = getContainer()
      const prodRunService = container.resolve("production_runs") as any
      await prodRunService.updateProductionRuns({
        id: runId,
        status: "sent_to_partner",
      })

      const acceptRes = await api
        .post(`/partners/production-runs/${runId}/accept`, {}, { headers: partnerHeaders })
        .catch((e: any) => e.response)
      if (acceptRes.status !== 200) {
        throw new Error(`Accept failed ${acceptRes.status}: ${JSON.stringify(acceptRes.data)}`)
      }

      const startRes = await api
        .post(`/partners/production-runs/${runId}/start`, {}, { headers: partnerHeaders })
        .catch((e: any) => e.response)
      if (startRes.status !== 200) {
        throw new Error(`Start failed ${startRes.status}: ${JSON.stringify(startRes.data)}`)
      }

      const finishRes = await api
        .post(
          `/partners/production-runs/${runId}/finish`,
          { finish_notes: "Batch done" },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)
      if (finishRes.status !== 200) {
        throw new Error(`Finish failed ${finishRes.status}: ${JSON.stringify(finishRes.data)}`)
      }

      // Complete with produced_quantity
      const completeRes = await api
        .post(
          `/partners/production-runs/${runId}/complete`,
          {
            produced_quantity: 9,
            rejected_quantity: 1,
            rejection_reason: "fabric_flaw",
            partner_cost_estimate: 900,
            cost_type: "total",
            notes: "Good batch",
          },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      if (completeRes.status !== 200) {
        throw new Error(`Complete failed ${completeRes.status}: ${JSON.stringify(completeRes.data)}`)
      }
      expect(completeRes.data.production_run.status).toBe("completed")
      expect(completeRes.data.production_run.produced_quantity).toBe(9)

      // Verify inventory was stocked: the 9 GOOD units reported (#2271)
      // Find inventory item by design's variant SKU
      const approveRes2 = await api.get(
        `/admin/products?q=InvStock Run Design&fields=*variants`,
        adminHeaders
      )
      const product = approveRes2.data.products?.[0]
      const variant = product?.variants?.[0]

      /**
       * Unconditional on purpose. Both of the `if`s that used to wrap this
       * turned "nothing was stocked" into a silent pass — the exact outcome the
       * test exists to catch. If the variant, the inventory item or the level is
       * missing, that IS the failure. #2053
       */
      expect(variant?.sku).toBeDefined()

      const invRes = await api.get(
        `/admin/inventory-items?sku=${variant.sku}&fields=*location_levels`,
        adminHeaders
      )
      const invItem = invRes.data.inventory_items?.[0]
      expect(invItem).toBeDefined()

      const level = (invItem.location_levels || []).find(
        (l: any) => l.location_id === stockLocationId
      )
      expect(level).toBeDefined()
      /**
       * #2271 — produced_quantity IS the good output (founder 2026-09-25): 9
       * good + 1 rejected accounts for the 10 ordered, and all 9 are banked at
       * the PARTNER's warehouse. This test used to expect 8, pinning a stocking
       * step that subtracted the rejects a second time.
       */
      expect(level.stocked_quantity).toBe(9)
    })
  })
})
