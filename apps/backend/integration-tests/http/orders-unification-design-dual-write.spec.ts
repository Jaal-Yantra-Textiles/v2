/**
 * #342 T3.2 — design-side dual-write shim.
 *
 * Creating/approving/transitioning a production run must additionally project
 * and maintain a core `order` (kind=design, discriminated by the
 * order↔production_run link since Chunk 6) per
 * apps/docs/notes/ORDERS_UNIFICATION_342.md §4 + §5, without ever failing the
 * legacy run path. Child runs (the partner-facing unit) get their own orders;
 * a split parent's order is canceled as superseded.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import partnerOrderLink from "../../src/links/partner-order"
import designOrderLink from "../../src/links/design-order-link"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Orders unification design dual-write (#342 T3.2)", () => {
    let adminHeaders: any
    let unique: number

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(
          `POST ${url} failed: ${err?.response?.status} ${JSON.stringify(
            err?.response?.data
          )}`
        )
      }
    }

    const createRegion = async () => {
      const container = getContainer()
      const regionService: any = container.resolve(Modules.REGION)
      const region = await regionService.createRegions({
        name: "India",
        currency_code: "inr",
        countries: ["in"],
      })
      return region.id
    }

    const createPartner = async (label = "p") => {
      const email = `design-unification-${label}-${unique}@jyt.test`
      const password = "supersecret"
      await post("/auth/partner/emailpass/register", { email, password })
      const firstLogin = await post("/auth/partner/emailpass", { email, password })
      const res = await post(
        "/partners",
        {
          name: `Design Unification Partner ${label} ${unique}`,
          handle: `design-unification-${label}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${firstLogin.data.token}` } }
      )
      expect(res.status).toBe(200)
      // Fresh token after partner creation (stale token misses the partner)
      const freshLogin = await post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id,
        partnerHeaders: {
          headers: { Authorization: `Bearer ${freshLogin.data.token}` },
        },
      }
    }

    const createTemplate = async (name: string) => {
      const res = await post(
        "/admin/task-templates",
        {
          name,
          description: `${name} template`,
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Design Unification Test",
        },
        adminHeaders
      )
      expect([200, 201]).toContain(res.status)
      return name
    }

    const createDesign = async () => {
      const res = await post(
        "/admin/designs",
        {
          name: `Unification Design ${unique}`,
          description: "Design for #342 dual-write test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    const fetchRun = async (id: string) => {
      const container = getContainer()
      const productionRunService: any = container.resolve("production_runs")
      return productionRunService.retrieveProductionRun(id)
    }

    const fetchUnifiedOrder = async (unifiedOrderId: string) => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        filters: { id: unifiedOrderId },
        fields: [
          "id",
          "status",
          "currency_code",
          "email",
          "customer_id",
          "metadata",
          "unified_order_status.partner_status",
          "total",
          "sales_channel.name",
          "items.*",
        ],
      })
      return data?.[0]
    }

    // Chunk 6: resolve a run's unified order via the order↔production_run link
    // (forward `.order`), not the retired run.metadata.unified_order_id backref.
    const unifiedOrderIdOf = async (runId: string) => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "production_runs",
        filters: { id: runId },
        fields: ["id", "order.id"],
      })
      return data?.[0]?.order?.id ?? null
    }

    beforeEach(async () => {
      const container = getContainer()
      unique = Date.now()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("dual-writes a kind=design core order on run create", async () => {
      await createRegion()
      const designId = await createDesign()

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        { quantity: 5 },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.production_run.id

      const unifiedOrderId = await unifiedOrderIdOf(runId)
      expect(unifiedOrderId).toBeTruthy()
      const unified = await fetchUnifiedOrder(unifiedOrderId)

      // §2/§4 projection metadata (the kind=design discriminator is the
      // order↔production_run link, asserted forward below).
      expect(unified.metadata.legacy_id).toBe(runId)
      // Chunk 6 regression: `kind` is no longer written onto the order (the
      // link IS the discriminator now).
      expect(unified.metadata.kind).toBeUndefined()
      expect(unified.metadata.production_run_id).toBe(runId)
      expect(unified.metadata.run_type).toBe("production")
      expect(unified.metadata.currency_assumed).toBe(true)
      // legacy run metadata merged in (route stamps this source)
      expect(unified.metadata.source).toBe("admin.designs.manual")

      // §5: pending_review → core draft, no partner_status yet
      expect(unified.status).toBe("draft")
      expect(unified.unified_order_status?.partner_status ?? null).toBeNull()

      // GAP-3 recipe: customer-less
      expect(unified.customer_id ?? null).toBeNull()
      expect(unified.email ?? null).toBeNull()

      // Internal channel, one line per design (no cost estimate yet → 0)
      expect(unified.sales_channel?.name).toBe("Partner Work Orders")
      expect(unified.items).toHaveLength(1)
      expect(Number(unified.items[0].quantity)).toBe(5)
      expect(Number(unified.items[0].unit_price)).toBe(0)
      expect(unified.items[0].metadata.design_id).toBe(designId)

      // §4 — design ↔ order link reused
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: designLinks } = await query.graph({
        entity: designOrderLink.entryPoint,
        filters: { order_id: unifiedOrderId },
        fields: ["design_id", "order_id"],
      })
      expect(designLinks).toHaveLength(1)
      expect(designLinks[0].design_id).toBe(designId)

      // D5-2: the order↔production_run link is the authoritative pointer +
      // kind=design discriminator. Resolve it forward (run → unified order)
      // via query.graph — the same join D5-3 reads switch to.
      const { data: linkedRuns } = await query.graph({
        entity: "production_runs",
        filters: { id: runId },
        fields: ["id", "order.id"],
      })
      expect(linkedRuns?.[0]?.order?.id).toBe(unifiedOrderId)

      // Legacy run untouched — Chunk 6 stopped writing the projection backref;
      // order_id still means "source retail order" (deviation note in the doc)
      const run: any = await fetchRun(runId)
      expect(run.status).toBe("pending_review")
      expect(run.order_id ?? null).toBeNull()
      expect(run.metadata?.unified_order_id ?? null).toBeNull()
    })

    it("projects child runs on approve, supersedes the parent order, links partner on send, and mirrors the partner lifecycle", async () => {
      await createRegion()
      const designId = await createDesign()
      const { partnerId, partnerHeaders } = await createPartner()
      const templateName = await createTemplate(`design-unification-cutting-${unique}`)

      // create + approve + dispatch in one call
      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            {
              partner_id: partnerId,
              quantity: 4,
              role: "manufacturing",
              template_names: [templateName],
            },
          ],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const parentId = createRes.data.production_run.id
      const childId = createRes.data.children[0].id

      // Parent order: created at create time, then superseded by the split
      const parentOrderId = await unifiedOrderIdOf(parentId)
      expect(parentOrderId).toBeTruthy()
      const parentOrder = await fetchUnifiedOrder(parentOrderId)
      expect(parentOrder.status).toBe("canceled")
      expect(parentOrder.metadata.superseded_by_run_ids).toEqual([childId])

      // Child order: the partner-facing commercial artifact (§4)
      const childOrderId = await unifiedOrderIdOf(childId)
      expect(childOrderId).toBeTruthy()
      expect(childOrderId).not.toBe(parentOrderId)
      let childOrder = await fetchUnifiedOrder(childOrderId)
      expect(Number(childOrder.items[0].quantity)).toBe(4)
      // sent_to_partner → core pending + partner_status assigned
      expect(childOrder.status).toBe("pending")
      expect(childOrder.unified_order_status?.partner_status).toBe("assigned")

      // D3: partner ↔ order link row exists on the child order
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: linkRows } = await query.graph({
        entity: partnerOrderLink.entryPoint,
        filters: { order_id: childOrderId },
        fields: ["partner_id", "order_id"],
      })
      expect(linkRows).toHaveLength(1)
      expect(linkRows[0].partner_id).toBe(partnerId)

      // D5-2: each child run owns its own order↔production_run link, and the
      // parent run still points at its (now superseded) order. Confirms the
      // re-entrant projection links every child distinctly rather than reusing
      // the parent's order.
      const { data: childLink } = await query.graph({
        entity: "production_runs",
        filters: { id: childId },
        fields: ["id", "order.id"],
      })
      expect(childLink?.[0]?.order?.id).toBe(childOrderId)
      const { data: parentLink } = await query.graph({
        entity: "production_runs",
        filters: { id: parentId },
        fields: ["id", "order.id"],
      })
      expect(parentLink?.[0]?.order?.id).toBe(parentOrderId)

      // ——— partner lifecycle: accept → start → finish → complete ———
      const accept = await post(
        `/partners/production-runs/${childId}/accept`,
        {},
        partnerHeaders
      )
      expect(accept.status).toBe(200)
      childOrder = await fetchUnifiedOrder(childOrderId)
      expect(childOrder.status).toBe("pending")
      expect(childOrder.unified_order_status?.partner_status).toBe("accepted")

      const start = await post(
        `/partners/production-runs/${childId}/start`,
        {},
        partnerHeaders
      )
      expect(start.status).toBe(200)
      childOrder = await fetchUnifiedOrder(childOrderId)
      expect(childOrder.unified_order_status?.partner_status).toBe("in_progress")

      const finish = await post(
        `/partners/production-runs/${childId}/finish`,
        {},
        partnerHeaders
      )
      expect(finish.status).toBe(200)
      childOrder = await fetchUnifiedOrder(childOrderId)
      expect(childOrder.status).toBe("pending")
      expect(childOrder.unified_order_status?.partner_status).toBe("finished")

      const complete = await post(
        `/partners/production-runs/${childId}/complete`,
        {},
        partnerHeaders
      )
      expect(complete.status).toBe(200)
      childOrder = await fetchUnifiedOrder(childOrderId)
      expect(childOrder.status).toBe("completed")
      expect(childOrder.unified_order_status?.partner_status).toBe("completed")

      // Parent order stays superseded even after the completion cascade
      const parentAfter = await fetchUnifiedOrder(parentOrderId)
      expect(parentAfter.status).toBe("canceled")
    })

    it("reassigns a partner decline (run parked, order left active) [#1093]", async () => {
      await createRegion()
      const designId = await createDesign()
      const { partnerId, partnerHeaders } = await createPartner("decline")
      const templateName = await createTemplate(`design-unification-decline-${unique}`)

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            {
              partner_id: partnerId,
              quantity: 2,
              template_names: [templateName],
            },
          ],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const childId = createRes.data.children[0].id
      const childOrderId = await unifiedOrderIdOf(childId)
      expect(childOrderId).toBeTruthy()

      const decline = await post(
        `/partners/production-runs/${childId}/decline`,
        { reason: "capacity", notes: "unification decline test" },
        partnerHeaders
      )
      expect(decline.status).toBe(200)

      // #1093: decline now reassigns — the run is parked + unassigned, and the
      // customer's order is NOT canceled (a new partner will pick it up).
      const declinedRun = (await fetchRun(childId)) as any
      expect(declinedRun.status).toBe("awaiting_reassignment")
      expect(declinedRun.partner_id).toBeFalsy()
      expect(declinedRun.previous_partner_id).toBe(partnerId)

      const childOrder = await fetchUnifiedOrder(childOrderId)
      expect(childOrder.status).not.toBe("canceled")
      expect(childOrder.unified_order_status?.partner_status).not.toBe("declined")
    })

    it("mirrors an admin cancel as canceled without touching partner_status", async () => {
      await createRegion()
      const designId = await createDesign()

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        { quantity: 3 },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.production_run.id
      const unifiedOrderId = await unifiedOrderIdOf(runId)
      expect(unifiedOrderId).toBeTruthy()

      const cancel = await post(
        `/admin/production-runs/${runId}/cancel`,
        { reason: "test cancel" },
        adminHeaders
      )
      expect(cancel.status).toBe(200)

      const unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.status).toBe("canceled")
      // §5 defines no partner_status for an admin cancel
      expect(unified.unified_order_status?.partner_status ?? null).toBeNull()
    })

    it("resolves the unified order via the link, not the metadata backref (D5-3)", async () => {
      // Chunk 3/6 — the run status mirror (incl. the admin cancel route)
      // resolves the unified order through the order↔production_run link
      // (query.graph forward `.order`) with PRIORITY over the transitional
      // run.metadata.unified_order_id fallback (Chunk 6 no longer writes it).
      // POISON the backref with a bogus id, leave the link intact: the mirror
      // must still cancel the REAL order, which is only possible via the link.
      await createRegion()
      const designId = await createDesign()

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        { quantity: 4 },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.production_run.id
      const unifiedOrderId = await unifiedOrderIdOf(runId)
      expect(unifiedOrderId).toBeTruthy()

      const container = getContainer()
      const productionRunService: any = container.resolve("production_runs")
      await productionRunService.updateProductionRuns({
        id: runId,
        metadata: { unified_order_id: "order_bogus_does_not_exist" },
      })
      expect((await fetchRun(runId)).metadata?.unified_order_id).toBe(
        "order_bogus_does_not_exist"
      )

      const cancel = await post(
        `/admin/production-runs/${runId}/cancel`,
        { reason: "link-resolution test" },
        adminHeaders
      )
      expect(cancel.status).toBe(200)

      const unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.status).toBe("canceled")
    })

    it("does not fail the legacy run path when the dual-write cannot run (no region)", async () => {
      // No region created — the projection must skip, not throw
      const designId = await createDesign()

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        { quantity: 2 },
        adminHeaders
      )
      expect(createRes.status).toBe(201)
      const runId = createRes.data.production_run.id

      const run: any = await fetchRun(runId)
      expect(run.status).toBe("pending_review")
      // No projection → no order↔production_run link.
      expect(await unifiedOrderIdOf(runId)).toBeFalsy()

      // Later transitions stay non-fatal without a unified order
      const cancel = await post(
        `/admin/production-runs/${runId}/cancel`,
        { reason: "no region cancel" },
        adminHeaders
      )
      expect(cancel.status).toBe(200)
      expect(((await fetchRun(runId)) as any).status).toBe("cancelled")
    })
  })
})
