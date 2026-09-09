import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { estimateDesignCostWorkflow } from "../../src/workflows/designs/estimate-design-cost"
import { PLATFORM_COST_CONFIG_MODULE } from "../../src/modules/platform-cost-config/module-key"

jest.setTimeout(120 * 1000)

/**
 * #1939 slice 1 — the pricers READ the policy table.
 *
 * #1942 put the platform's economic policy in an effective-dated table and
 * deliberately left the compiled constants authoritative: nothing read it. So
 * inserting the founder's 30% row would have changed no price, silently.
 *
 * 🔴 This spec exists because "wired" and "working" are different claims and a
 * no-op proof cannot tell them apart. Against the seeded row the wiring
 * changes nothing — which is the point, and also means every existing test
 * passing proves only that nothing broke. The only way to show the config is
 * actually read is to make it DIFFER and watch the number move.
 */
setupSharedTestSuite(() => {
  describe("#1939 — the estimator prices from the config table", () => {
    let adminHeaders: { headers: Record<string, string> }

    const { api, getContainer } = getSharedTestEnv()

    const makeDesign = async (name: string): Promise<string> => {
      const res = await api.post(
        "/admin/designs",
        {
          name,
          description: "cost-config wiring spec",
          design_type: "Original",
          status: "Conceptual",
          priority: "Medium",
          estimated_cost: 1000,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    const estimate = async (designId: string) => {
      const { result }: any = await estimateDesignCostWorkflow(
        getContainer()
      ).run({ input: { design_id: designId } })
      return result
    }

    /** Wipe the policy table so each case starts from a known world. */
    const clearConfig = async () => {
      const svc: any = getContainer().resolve(PLATFORM_COST_CONFIG_MODULE)
      const rows = await svc.listPlatformCostConfigs({}, { take: null })
      for (const row of rows ?? []) {
        await svc.deletePlatformCostConfigs(row.id)
      }
    }

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("falls back to the compiled constant when NOTHING is configured, then follows the table", async () => {
      const stamp = Date.now()
      await clearConfig()

      // ── No policy at all: the compiled 30% overhead answers ──────────────
      const designId = await makeDesign(`Cost Config A ${stamp}`)
      const unconfigured = await estimate(designId)
      expect(unconfigured.breakdown.production_percent).toBe(30)

      /**
       * 🔴 The failure mode this guards. `loadCostConfig` must never turn an
       * empty table into zeros — an estimator that reported "found nothing" as
       * 0 reached storefront checkout once already.
       */
      expect(unconfigured.total_estimated).toBeGreaterThan(0)

      // ── A policy row with a DIFFERENT overhead: the number moves ─────────
      const inserted = await api.post(
        "/admin/platform-cost-config",
        {
          production_overhead_percent: 60,
          notes: `wiring spec ${stamp}`,
        },
        adminHeaders
      )
      expect([200, 201]).toContain(inserted.status)

      const configured = await estimate(await makeDesign(`Cost Config B ${stamp}`))
      expect(configured.breakdown.production_percent).toBe(60)

      /**
       * And the invariant #1554 exists to protect still holds under config:
       * material + production + platform fee === total. A design costed from
       * an admin estimate splits that estimate by the overhead, so the SPLIT
       * moves with the policy even though the total does not — which is the
       * behaviour to check, not the total.
       */
      const sum = (r: any) =>
        Math.round(
          (Number(r.material_cost) +
            Number(r.production_cost) +
            Number(r.platform_fee ?? 0)) *
            100
        ) / 100
      expect(sum(configured)).toBeCloseTo(Number(configured.total_estimated), 2)
      expect(sum(unconfigured)).toBeCloseTo(Number(unconfigured.total_estimated), 2)

      // A higher overhead claims MORE of the same total as production.
      expect(Number(configured.production_cost)).toBeGreaterThan(
        Number(unconfigured.production_cost)
      )
      expect(Number(configured.material_cost)).toBeLessThan(
        Number(unconfigured.material_cost)
      )

      await clearConfig()
    })

    it("survives a container with no policy module at all", async () => {
      // The reader must answer EMPTY rather than throw — a platform that has
      // never been configured still has to be able to price.
      const { loadCostConfig, EMPTY_COST_CONFIG } = await import(
        "../../src/modules/platform-cost-config/read-config"
      )
      const resolved = await loadCostConfig({
        resolve: () => {
          throw new Error("not registered")
        },
      } as any)
      expect(resolved).toEqual(EMPTY_COST_CONFIG)
      expect(resolved.production_overhead_percent).toBeNull()
      // Null, not 0. A zero here would price every design at material cost.
      expect(resolved.approval_markup_multiplier).toBeNull()
    })
  })
})
