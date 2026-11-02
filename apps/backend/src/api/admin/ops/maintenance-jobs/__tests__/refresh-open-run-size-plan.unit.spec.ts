import { planRunSizeRefresh } from "../refresh-open-run-size-plan-job"

// Shaped like Shramdaan's #152 runs (2026-11-02): dispatched before #2505, so
// no plan, and snapshotted before #2509, so no color_mode.
const jacketRun = {
  id: "run_jacket",
  status: "sent_to_partner",
  quantity: 2,
  planned_output: null,
  produced_output: null,
  snapshot: { size_sets: [{ size_label: "38" }, { size_label: "40" }], colors: [] },
}
const bagRun = {
  id: "run_bag",
  status: "sent_to_partner",
  quantity: 10,
  planned_output: null,
  produced_output: null,
  snapshot: {
    size_sets: [{ size_label: "Custom Bag" }],
    colors: [{ name: "Black" }, { name: "White embroidery thread" }],
  },
}

describe("planRunSizeRefresh (#2500)", () => {
  it("fills a missing plan from the sizes the run snapshotted", () => {
    const plan = planRunSizeRefresh({ run: jacketRun, design: { color_mode: "variants", product_type: "jacket" } })
    expect(plan).toMatchObject({
      ok: true,
      snapshot: null,
      planned_output: [
        { size_label: "38", quantity: 1 },
        { size_label: "40", quantity: 1 },
      ],
      size_note: "38×1, 40×1",
    })
  })

  it("copies 'parts' into the snapshot and plans by size only", () => {
    const plan = planRunSizeRefresh({ run: bagRun, design: { color_mode: "parts", product_type: "tote_bag" } })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.color_mode).toEqual({ before: null, after: "parts" })
    expect(plan.snapshot?.color_mode).toBe("parts")
    expect(plan.snapshot?.colors).toHaveLength(2)
    expect(plan.planned_output).toEqual([{ size_label: "Custom Bag", color: null, quantity: 10 }])
  })

  it("never overwrites a plan that exists", () => {
    const plan = planRunSizeRefresh({
      run: { ...jacketRun, planned_output: [{ size_label: "40", quantity: 2 }] },
      design: { color_mode: "variants", product_type: "jacket" },
    })
    expect(plan.ok).toBe(false)
  })

  it("leaves completed runs and runs with produced output alone", () => {
    expect(planRunSizeRefresh({ run: { ...jacketRun, status: "completed" }, design: {} }).ok).toBe(false)
    expect(
      planRunSizeRefresh({
        run: { ...jacketRun, produced_output: [{ size_label: "38", quantity: 2 }] },
        design: {},
      }).ok
    ).toBe(false)
  })

  it("refuses a garment run that snapshotted no sizes, but still copies the colour mode", () => {
    const noSizes = { ...jacketRun, snapshot: { size_sets: [], colors: [{ name: "Red" }, { name: "Gold" }] } }
    expect(planRunSizeRefresh({ run: noSizes, design: { color_mode: "variants", product_type: "jacket" } }).ok).toBe(false)
    const plan = planRunSizeRefresh({ run: noSizes, design: { color_mode: "parts", product_type: "jacket" } })
    expect(plan.ok && plan.planned_output).toBeNull()
    expect(plan.ok && plan.snapshot?.color_mode).toBe("parts")
  })
})
