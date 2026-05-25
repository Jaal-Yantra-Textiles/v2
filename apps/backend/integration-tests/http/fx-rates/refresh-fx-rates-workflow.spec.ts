import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { FX_RATES_MODULE } from "../../../src/modules/fx_rates"
import type FxRatesService from "../../../src/modules/fx_rates/service"
import type { FxProvider } from "../../../src/modules/fx_rates/providers/types"
import refreshFxRatesWorkflow from "../../../src/workflows/fx/refresh-fx-rates"

jest.setTimeout(60 * 1000)

// Workflow is a thin wrapper around the service; the heavy lifting is
// already covered in fx-rates-service.spec.ts. This file just verifies:
//
//   1. The workflow can be invoked and returns the summary shape the
//      visual flow's trigger_workflow operation will get.
//   2. The container resolution works (FX_RATES_MODULE is registered).
//   3. The injected provider's rates land in the fx_rate table.

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("workflows/fx/refresh-fx-rates", () => {
    let svc: FxRatesService
    let container: any

    beforeEach(async () => {
      container = getContainer()
      svc = container.resolve(FX_RATES_MODULE) as FxRatesService
      // Test runner truncates between tests; no manual cleanup needed.
    })

    it("returns the summary shape visual flow operation will receive", async () => {
      const fake: FxProvider = {
        fetchRates: async () => ({
          base_currency: "usd",
          fetched_at: new Date("2026-05-26T02:00:00Z"),
          source: "test-fake",
          rates: { usd: 1, inr: 83.5, eur: 0.93 },
        }),
      }
      svc.setProvider(fake)

      const { result } = await refreshFxRatesWorkflow(container).run({
        input: {},
      })

      expect(result).toMatchObject({
        base_currency: "usd",
        upserted: 3,
        source: "test-fake",
      })
      expect(typeof result.fetched_at).toBe("string")
      expect(new Date(result.fetched_at).toISOString()).toBe(
        "2026-05-26T02:00:00.000Z"
      )

      // And the rows actually landed.
      const rows = await svc.listFxRates({})
      expect(rows.length).toBe(3)
      const quote_codes = rows.map((r: any) => r.quote_currency).sort()
      expect(quote_codes).toEqual(["eur", "inr", "usd"])
    })

    it("is idempotent — running twice doesn't duplicate rows", async () => {
      const fake: FxProvider = {
        fetchRates: async () => ({
          base_currency: "usd",
          fetched_at: new Date("2026-05-26T02:00:00Z"),
          source: "test-fake",
          rates: { usd: 1, inr: 83.5 },
        }),
      }
      svc.setProvider(fake)

      await refreshFxRatesWorkflow(container).run({ input: {} })
      const firstCount = (await svc.listFxRates({})).length

      // Second run with newer timestamp — same upsert behavior, no dupes.
      svc.setProvider({
        fetchRates: async () => ({
          base_currency: "usd",
          fetched_at: new Date("2026-05-26T03:00:00Z"),
          source: "test-fake",
          rates: { usd: 1, inr: 83.6 },
        }),
      })

      await refreshFxRatesWorkflow(container).run({ input: {} })
      const secondRows = await svc.listFxRates({})

      expect(secondRows.length).toBe(firstCount)
      const inrRow = secondRows.find((r: any) => r.quote_currency === "inr")
      expect(Number((inrRow as any).rate)).toBeCloseTo(83.6, 4)
    })
  })
})
