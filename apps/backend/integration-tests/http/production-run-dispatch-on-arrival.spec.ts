import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

/**
 * What happens to a run when its cloth actually lands (#2202), end to end.
 *
 * 🔴 THIS SUITE EXISTS BECAUSE THE UNIT TESTS CANNOT DO ITS JOB.
 * Every unit test of this path stubs `query.graph`, the policy service and the
 * notification module, so together they prove only that the resolver acts on
 * whatever it is handed. None of them proves that delivering an inventory order
 * REACHES the release code at all — the event bus, the subscriber registration,
 * the `Delivered` constant and the dependency read are all outside the stubs.
 *
 * The thing being protected is a date: when the GOF cloth lands, four runs
 * either dispatch or sit silent, and nobody finds out from a unit test.
 *
 * Three outcomes, one delivery each:
 *   1. an approval's own templates dispatch the run
 *   2. no templates + a matching policy rule → the rule dispatches it
 *   3. no templates + no matching rule → nothing dispatches, somebody is told
 */
jest.setTimeout(180 * 1000)

/** The release runs off the event bus, so the outcome lands a beat later. */
const waitFor = async <T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  tries = 40
): Promise<T> => {
  let last = await read()
  for (let i = 0; i < tries && !ok(last); i++) {
    await new Promise((r) => setTimeout(r, 250))
    last = await read()
  }
  return last
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("production run → dispatch when the material arrives", () => {
    let headers: any
    let designId: string
    let inventoryOrderId: string
    let partnerId: string
    let chosenTemplateId: string
    let policyTemplateId: string
    let productionRunsModuleKey: string

    const runService = () => getContainer().resolve(productionRunsModuleKey) as any

    const readRun = async (id: string) => {
      const svc = runService()
      return svc.retrieveProductionRun(id)
    }

    /**
     * Create the run directly through the module, NOT the admin route.
     *
     * The create route cannot express this shape: it accepts neither `status`
     * nor `depends_on_inventory_order_ids`, because in the ordinary flow both
     * are written by approval. The runs this suite is about are precisely the
     * ones that never went through approval — born `approved` from
     * `order.placed`, carrying a dependency and no templates — so the only
     * honest way to reproduce one is to write the row the way the order path
     * does.
     */
    const seedRun = async (extra: Record<string, any>) => {
      const svc = runService()
      const created = await svc.createProductionRuns({
        design_id: designId,
        partner_id: partnerId,
        quantity: 1,
        run_type: "production",
        status: "approved",
        depends_on_inventory_order_ids: [inventoryOrderId],
        metadata: { source: "order.placed", is_custom_design: true },
        /*
         * `snapshot` is REQUIRED on the model — a run records what it was
         * asked to make at the moment it was created, so the work is still
         * readable after the design moves on. Every run on prod carries one;
         * a seed without it is not a run this code would ever meet.
         */
        snapshot: {
          design: { id: designId, name: "Dispatch Test Design", status: "Conceptual" },
          colors: [],
          product: null,
          size_sets: [],
          specifications: [],
          inventory_links: [],
          provenance: { quantity: 1, partner_id: partnerId },
          captured_at: new Date().toISOString(),
        },
        captured_at: new Date().toISOString(),
        ...extra,
      })
      return (Array.isArray(created) ? created[0] : created) as any
    }

    const setDispatchDefaults = async (rules: any[]) => {
      /*
       * 🔴 READ THEN WRITE. `updatePolicy` replaces `config` WHOLESALE, so
       * writing the rules alone would drop the transition table and the
       * reassignment block — the same shape as a variant price save that
       * replaces the entire price set.
       */
      const current = await api.get("/admin/production-run-policy", headers)
      const stored = current.data.policy?.config ?? {}
      // PUT, not POST — the route exports GET and PUT only, and a POST here
      // 404s with an HTML body rather than a JSON error.
      await api.put(
        "/admin/production-run-policy",
        { config: { ...stored, dispatch_defaults: rules } },
        headers
      )
    }

    const deliver = async () => {
      const workflowModule =
        "../../src/workflows/inventory_orders/update-inventory-order"
      const { updateInventoryOrderWorkflow } = await import(workflowModule)
      return updateInventoryOrderWorkflow(getContainer()).run({
        input: { id: inventoryOrderId, update: { status: "Delivered" } },
        throwOnError: false,
      })
    }

    const feedNotices = async () => {
      const svc = getContainer().resolve(Modules.NOTIFICATION) as any
      const rows = await svc.listNotifications({ channel: "feed" })
      return (rows || []) as any[]
    }

    beforeAll(async () => {
      /*
       * Lazy, variable specifier. A top-level import of a module-registration
       * file throws at module evaluation in this harness, and a suite that
       * fails to LOAD reports ZERO tests — which reads exactly like a pass.
       */
      const mod = "../../src/modules/production_runs"
      productionRunsModuleKey = (await import(mod)).PRODUCTION_RUNS_MODULE
    })

    beforeEach(async () => {
      try {
        const container = getContainer()
        await createAdminUser(container)
        headers = await getAuthHeaders(api)

        const stamp = Date.now()

        // Two DIFFERENT templates, so "which one dispatched" is answerable.
        const mk = async (name: string) => {
          const res = await api.post(
            "/admin/task-templates",
            {
              name,
              description: name,
              priority: "medium",
              estimated_duration: 60,
              required_fields: {},
              eventable: true,
              notifiable: true,
              /*
               * No category. It is optional on the route, a fresh test DB has
               * none of prod's five, and dispatch resolves templates by ID —
               * the category only matters when a NAME has to be disambiguated.
               */
            },
            headers
          )
          return (
            res.data.task_template?.id ??
            res.data.taskTemplate?.id ??
            res.data.template?.id
          )
        }
        chosenTemplateId = await mk(`Chosen At Approval ${stamp}`)
        policyTemplateId = await mk(`Chosen By Policy ${stamp}`)

        const designRes = await api.post(
          "/admin/designs",
          {
            name: `Dispatch Test Design ${stamp}`,
            description: "Waiting on cloth",
            design_type: "Original",
            status: "Conceptual",
            priority: "Medium",
            product_type: "robe",
          },
          headers
        )
        designId = designRes.data.design.id

        /*
         * The admin route creates a partner AND its first admin together —
         * `{ partner, admin }`, not a flat body. A partner with nobody able to
         * sign in is not a partner anyone can dispatch work to.
         */
        const partnerRes = await api.post(
          "/admin/partners",
          {
            partner: {
              name: `Dispatch Test Partner ${stamp}`,
              handle: `dispatch-test-${stamp}`,
              status: "active",
              is_verified: true,
            },
            admin: {
              email: `dispatch-partner-${stamp}@test.com`,
              first_name: "Dispatch",
              last_name: "Partner",
            },
          },
          headers
        )
        partnerId = partnerRes.data.partner.id

        const itemRes = await api.post(
          "/admin/inventory-items",
          { title: `Dispatch Cloth ${stamp}` },
          headers
        )
        const inventoryItemId = itemRes.data.inventory_item.id

        const locRes = await api.post(
          "/admin/stock-locations",
          { name: `Dispatch WH ${stamp}` },
          headers
        )
        const stockLocationId = locRes.data.stock_location.id

        const orderRes = await api.post(
          "/admin/inventory-orders",
          {
            order_lines: [
              { inventory_item_id: inventoryItemId, quantity: 10, price: 100 },
            ],
            quantity: 10,
            total_price: 1000,
            status: "Pending",
            expected_delivery_date: new Date(Date.now() + 7 * 864e5).toISOString(),
            order_date: new Date().toISOString(),
            shipping_address: {
              address_1: "1 Loom Lane",
              city: "Dharamshala",
              postal_code: "176215",
              country_code: "IN",
            },
            stock_location_id: stockLocationId,
            to_stock_location_id: stockLocationId,
          },
          headers
        )
        inventoryOrderId =
          orderRes.data.inventoryOrder?.id ?? orderRes.data.inventory_order?.id

        // Each test declares its own rules; start from none.
        await setDispatchDefaults([])
      } catch (e: any) {
        console.error(
          "SETUP FAILED",
          e?.config?.url,
          JSON.stringify(e?.response?.data)
        )
        throw e
      }
    })

    it("🔴 CONTROL: the run is waiting, and Shipped is not arrival", async () => {
      /*
       * If this is wrong every later assertion is meaningless: a run that was
       * never waiting would "dispatch" for reasons having nothing to do with
       * the cloth, and a suite that proves that proves nothing.
       */
      const run = await seedRun({ dispatch_template_ids: [chosenTemplateId] })

      const workflowModule =
        "../../src/workflows/inventory_orders/update-inventory-order"
      const { updateInventoryOrderWorkflow } = await import(workflowModule)
      await updateInventoryOrderWorkflow(getContainer()).run({
        input: { id: inventoryOrderId, update: { status: "Shipped" } },
        throwOnError: false,
      })

      await new Promise((r) => setTimeout(r, 1500))
      const after = await readRun(run.id)
      expect(after.status).toBe("approved")
      expect(after.dispatched_template_ids ?? null).toBeFalsy()
    })

    it("dispatches with the templates the approval recorded", async () => {
      const run = await seedRun({ dispatch_template_ids: [chosenTemplateId] })

      await deliver()

      const after = await waitFor(
        () => readRun(run.id),
        (r: any) => !!r?.dispatched_template_ids?.length
      )
      expect(after.dispatched_template_ids).toContain(chosenTemplateId)
      expect(after.status).not.toBe("approved")
    })

    it("🔴 dispatches from the POLICY when the run carries no templates", async () => {
      /*
       * The run this whole feature exists for: born from an order, so it can
       * never be approved and can never carry a selection.
       */
      await setDispatchDefaults([
        {
          when: { run_type: "production", product_type: "robe" },
          template_ids: [policyTemplateId],
        },
      ])
      const run = await seedRun({})

      await deliver()

      const after = await waitFor(
        () => readRun(run.id),
        (r: any) => !!r?.dispatched_template_ids?.length
      )
      expect(after.dispatched_template_ids).toContain(policyTemplateId)
      // And NOT the other one — proves which source was used, not merely that
      // something dispatched.
      expect(after.dispatched_template_ids).not.toContain(chosenTemplateId)
    })

    it("🔴 an approval's own choice still beats the policy", async () => {
      await setDispatchDefaults([
        {
          when: { run_type: "production", product_type: "robe" },
          template_ids: [policyTemplateId],
        },
      ])
      const run = await seedRun({ dispatch_template_ids: [chosenTemplateId] })

      await deliver()

      const after = await waitFor(
        () => readRun(run.id),
        (r: any) => !!r?.dispatched_template_ids?.length
      )
      expect(after.dispatched_template_ids).toContain(chosenTemplateId)
      expect(after.dispatched_template_ids).not.toContain(policyTemplateId)
    })

    it("🔴 does NOT dispatch when no rule matches, and TELLS somebody", async () => {
      // A rule for samples only; this run is production.
      await setDispatchDefaults([
        { when: { run_type: "sample" }, template_ids: [policyTemplateId] },
      ])
      const run = await seedRun({})

      const before = (await feedNotices()).length
      await deliver()

      const notices = await waitFor(
        feedNotices,
        (rows) =>
          rows.length > before &&
          rows.some((n: any) =>
            String(n?.data?.metadata?.production_run_id ?? "") === String(run.id)
          )
      )

      const mine = notices.find(
        (n: any) =>
          String(n?.data?.metadata?.production_run_id ?? "") === String(run.id)
      )
      expect(mine).toBeTruthy()
      expect(mine.data.metadata.reason).toBe("no_templates")
      expect(mine.data.metadata.released_by).toBe(inventoryOrderId)

      // …and the run really is still parked, not dispatched-and-also-notified.
      const after = await readRun(run.id)
      expect(after.status).toBe("approved")
      expect(after.dispatched_template_ids ?? null).toBeFalsy()
    })

    it("a sample run matches the sample rule, not the robe one", async () => {
      /*
       * Proves the match is on the RUN's own type rather than the design's
       * product_type alone — the design here is a robe either way.
       */
      await setDispatchDefaults([
        { when: { run_type: "sample" }, template_ids: [policyTemplateId] },
        {
          when: { run_type: "production", product_type: "robe" },
          template_ids: [chosenTemplateId],
        },
      ])
      const run = await seedRun({ run_type: "sample" })

      await deliver()

      const after = await waitFor(
        () => readRun(run.id),
        (r: any) => !!r?.dispatched_template_ids?.length
      )
      expect(after.dispatched_template_ids).toContain(policyTemplateId)
    })
  })
})
