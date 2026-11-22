const runEstimate = jest.fn()
jest.mock("../../../../../../../workflows/designs/estimate-design-cost", () => ({
  estimateDesignCostWorkflow: () => ({ run: runEstimate }),
}))

import { POST } from "../route"

/**
 * The preview is what someone reads before billing a customer. It must show
 * the price create will charge — an override wins over the estimator, exactly
 * as in create-draft-order-from-designs. (Seen live 2026-11-22: a ₹1 override
 * previewed as "total 0, unpriceable".)
 */
const call = async (body: any) => {
  const json = jest.fn()
  const res: any = { json, status: jest.fn(() => res) }
  const req: any = {
    validatedBody: body,
    scope: {
      resolve: () => ({
        graph: jest.fn(async ({ filters }: any) => ({ data: [{ id: filters.id, name: `Design ${filters.id}` }] })),
      }),
    },
  }
  await POST(req, res)
  return json.mock.calls[0][0]
}

beforeEach(() => {
  runEstimate.mockReset()
  runEstimate.mockResolvedValue({
    result: { total_estimated: 500, confidence: "estimated", material_cost: 300, production_cost: 200 },
  })
})

describe("design-order preview — price_overrides", () => {
  it("uses the override and skips the estimator for that design", async () => {
    const out = await call({ design_ids: ["d1"], currency_code: "inr", price_overrides: { d1: 1 }, override_currency: "inr" })
    expect(out.estimates[0]).toMatchObject({ design_id: "d1", unit_price: 1, confidence: "manual" })
    expect(out.total).toBe(1)
    expect(out.unpriceable).toEqual([])
    expect(out.total_is_complete).toBe(true)
    expect(out.currency_note).toBeNull()
    expect(runEstimate).not.toHaveBeenCalled()
  })

  it("still estimates designs without an override", async () => {
    const out = await call({ design_ids: ["d1", "d2"], price_overrides: { d1: 100 } })
    expect(out.estimates.map((e: any) => e.unit_price)).toEqual([100, 500])
    expect(out.total).toBe(600)
    expect(runEstimate).toHaveBeenCalledTimes(1)
  })

  it("an override of 0 is a real price, not a missing one", async () => {
    const out = await call({ design_ids: ["d1"], price_overrides: { d1: 0 } })
    expect(out.estimates[0].unit_price).toBe(0)
    expect(out.unpriceable).toEqual([])
  })

  it("flags overrides in another currency instead of silently mixing them", async () => {
    const out = await call({ design_ids: ["d1"], currency_code: "eur", price_overrides: { d1: 100 }, override_currency: "inr" })
    expect(out.currency_note).toMatch(/INR.*EUR/)
  })
})
