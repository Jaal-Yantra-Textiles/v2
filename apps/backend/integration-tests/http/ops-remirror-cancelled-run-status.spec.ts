import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { setUnifiedOrderPartnerStatus } from "../../src/workflows/inventory_orders/dual-write-unified-order"

jest.setTimeout(90 * 1000)

/**
 * #1574 — the cancelled-run status repair, end to end.
 *
 * The unit tests cover the CLASSIFICATION. They cannot cover the two things
 * that would actually make this job dangerous in production:
 *
 *  1. **Does `unified_order_status.partner_status` resolve through
 *     `query.graph` at all?** If it does not, `current_partner_status` is
 *     `null` for every row, every row classifies as `stale`, and the job
 *     "repairs" hundreds of healthy orders. A field the query never fetched
 *     reads exactly like a field whose value is absent.
 *
 *  2. **Does the readback observe a real write?** The mirror swallows its own
 *     failures, so a repair that reported success while writing nothing would
 *     look identical to one that worked.
 *
 * 🔑 The fixture manufactures the PRE-#1577 state deliberately. Cancelling a
 * run today writes `partner_status = "cancelled"` correctly — that is the fix.
 * The ~40 prod rows are ones that transitioned while the derivation returned
 * `undefined`, so the sidecar kept its last live value. Forcing the sidecar
 * back to `in_progress` after the cancel reproduces exactly that row, and it
 * is the only way to make this test fail when the job is broken.
 */
setupSharedTestSuite(() => {
  describe("ops: remirror-cancelled-run-status (#1574)", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    // 🔴 Per-test, not in beforeAll: the runner restores a DB snapshot before
    // every test, so a region created once would be gone by the second one.
    beforeEach(async () => {
      await createRegion()
    })

    /**
     * A region has to exist before a run projects — the unified order needs a
     * currency. Without it the projection is skipped and the run has no order,
     * which reads exactly like a broken link.
     */
    const createRegion = async () => {
      const regionService: any = getContainer().resolve(Modules.REGION)
      const region = await regionService.createRegions({
        name: "India",
        currency_code: "inr",
        countries: ["in"],
      })
      return region.id
    }

    /**
     * A cancelled run and the unified order it is linked to.
     *
     * ⚠️ The TOP-LEVEL run, not `children[0]`. An assignment's child run is
     * not projected to a unified order, so a fixture built on it reports
     * `no_unified_order` and every assertion below fails for a reason that has
     * nothing to do with the job. No partner is needed at all —
     * `deriveRunPartnerStatus` reads `run.status`, and a cancelled run says
     * "cancelled" whoever was holding it.
     */
    const cancelledRunWithOrder = async (unique: number) => {
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Remirror Design ${unique}`,
          description: "x",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      const designId = designRes.data.design.id

      const run = await api.post(
        `/admin/designs/${designId}/production-runs`,
        { quantity: 5 },
        adminHeaders
      )
      expect(run.status).toBe(201)
      const runId = run.data.production_run?.id
      expect(runId).toBeTruthy()

      const cancel = await api.post(
        `/admin/production-runs/${runId}/cancel`,
        { reason: "manufacturing the pre-#1577 row" },
        adminHeaders
      )
      expect(cancel.status).toBeLessThan(300)

      return { runId: runId as string, designId }
    }

    /** Read the sidecar the way nothing in the job does — independently. */
    const readSidecar = async (runId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: runRows } = await query.graph({
        entity: "production_runs",
        fields: ["id", "order.id"],
        filters: { id: runId },
      })
      const orderId = runRows?.[0]?.order?.id
      if (!orderId) return { orderId: undefined, partner_status: undefined }
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "unified_order_status.partner_status"],
        filters: { id: orderId },
      })
      return {
        orderId,
        partner_status: data?.[0]?.unified_order_status?.partner_status,
      }
    }

    const runJob = async (params: Record<string, unknown>, dry_run: boolean) => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/remirror-cancelled-run-status/run",
        { dry_run, params },
        adminHeaders
      )
      expect(res.status).toBeLessThan(300)
      return res.data.result
    }

    it("is listed as a maintenance job", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      const ids = (res.data.jobs || []).map((j: any) => j.id)
      expect(ids).toContain("remirror-cancelled-run-status")
    })

    it("🔑 repairs a stale sidecar and PROVES the write landed by re-reading it", async () => {
      const unique = Date.now()
      const { runId } = await cancelledRunWithOrder(unique)

      // The cancel path works today — this is #1577, and it is also what makes
      // the fixture below a deliberate regression rather than a lucky state.
      const afterCancel = await readSidecar(runId)
      expect(afterCancel.orderId).toBeTruthy()
      expect(afterCancel.partner_status).toBe("cancelled")

      // Manufacture the pre-#1577 row: the sidecar keeps its last live value
      // because the derivation returned `undefined` and the mirror writes only
      // truthy values.
      await setUnifiedOrderPartnerStatus(
        getContainer() as any,
        afterCancel.orderId,
        "in_progress"
      )
      expect((await readSidecar(runId)).partner_status).toBe("in_progress")

      // ── dry run ────────────────────────────────────────────────────────
      const dry = await runJob({ production_run_id: runId }, true)
      expect(dry.dry_run).toBe(true)
      expect(dry.applied).toBe(false)
      expect(dry.changes).toHaveLength(1)
      expect(dry.changes[0]).toMatchObject({
        entity: "order",
        id: afterCancel.orderId,
        field: "partner_status",
        before: "in_progress",
        after: "cancelled",
      })
      // 🔴 A dry run that wrote would be the worst possible bug in a repair job.
      expect((await readSidecar(runId)).partner_status).toBe("in_progress")

      // ── apply ──────────────────────────────────────────────────────────
      const applied = await runJob({ production_run_id: runId }, false)
      expect(applied.applied).toBe(true)
      expect(applied.errors ?? []).toHaveLength(0)

      // The assertion that matters. Read independently of anything the job
      // returned — the job's own summary is a claim, the column is the fact.
      expect((await readSidecar(runId)).partner_status).toBe("cancelled")

      // ── idempotent ─────────────────────────────────────────────────────
      const second = await runJob({ production_run_id: runId }, true)
      expect(second.changes).toHaveLength(0)
      expect(second.summary).toContain("1 already correct")
    })

    it("🔴 leaves an order that is ALREADY correct alone — the graph read really resolves the sidecar", async () => {
      // If `unified_order_status.partner_status` did not resolve through
      // query.graph, this row would read `null`, classify as `stale`, and the
      // job would "repair" a healthy order. That failure is invisible in the
      // test above, where the expected value happens to be what a broken read
      // would drive it to anyway.
      const unique = Date.now() + 1
      const { runId } = await cancelledRunWithOrder(unique)
      expect((await readSidecar(runId)).partner_status).toBe("cancelled")

      const dry = await runJob({ production_run_id: runId }, true)
      expect(dry.changes).toHaveLength(0)
      expect(dry.summary).toContain("0 stale")
      expect(dry.summary).toContain("1 already correct")
    })

    it("reports every bucket it examined, not just the stale ones", async () => {
      const unique = Date.now() + 2
      const { runId } = await cancelledRunWithOrder(unique)

      const verbose = await runJob(
        { production_run_id: runId, verbose: true },
        true
      )
      expect(verbose.changes).toHaveLength(1)
      expect(verbose.changes[0].note).toContain("already_correct")
      expect(verbose.summary).toMatch(
        /examined 1: \d+ stale, \d+ already correct, \d+ undeterminable, \d+ superseded, \d+ unlinked/
      )
    })

    it('does not read the string "false" as true', async () => {
      // `z.coerce.boolean()` would: Boolean("false") === true. Params arrive
      // over HTTP as strings, so this is the shape that actually ships.
      const unique = Date.now() + 3
      const { runId } = await cancelledRunWithOrder(unique)
      const res = await runJob(
        { production_run_id: runId, verbose: "false" },
        true
      )
      expect(res.changes).toHaveLength(0)
    })

    it("refuses a status it does not sweep", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/remirror-cancelled-run-status/run",
          { dry_run: true, params: { status: "not_a_status" } },
          adminHeaders
        )
      ).rejects.toThrow()
    })
  })
})
