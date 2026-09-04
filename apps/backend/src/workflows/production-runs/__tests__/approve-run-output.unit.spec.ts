const runWorkflow = jest.fn()
const createProductFromDesignWorkflow = jest.fn(() => ({ run: createProductRun }))
const createProductRun = jest.fn()
const updateDesignRun = jest.fn().mockResolvedValue({ result: {} })

jest.mock("../../designs/create-product-from-design", () => ({
  createProductFromDesignWorkflow: (...a: any[]) =>
    (createProductFromDesignWorkflow as any)(...a),
}))
jest.mock("../../designs/update-design", () => ({
  __esModule: true,
  default: () => ({ run: updateDesignRun }),
}))
jest.mock("../../../modules/production_runs", () => ({
  PRODUCTION_RUNS_MODULE: "production_runs",
}))

import {
  applyRunApprovals,
  resolveApprovalCurrency,
} from "../approve-run-output"

const listProductionRuns = jest.fn()
const updateProductionRuns = jest.fn().mockResolvedValue({})
const graph = jest.fn()
const emit = jest.fn().mockResolvedValue(undefined)

const container = {
  resolve: (key: string) => {
    if (key === "production_runs") {
      return { listProductionRuns, updateProductionRuns }
    }
    if (key === "query") return { graph }
    if (key === "logger") return { error: jest.fn(), info: jest.fn() }
    if (key === "event_bus") return { emit }
    return {}
  },
}

const completedRun = (id: string, design_id: string | null, extra: any = {}) => ({
  id,
  design_id,
  status: "completed",
  snapshot: { design: { name: `Design ${design_id}` } },
  approval_decision: null,
  ...extra,
})

/** A design the graph answers with. `products: []` = never approved. */
const design = (id: string, extra: any = {}) => ({
  id,
  name: `Design ${id}`,
  estimated_cost: 850,
  cost_currency: "inr",
  products: [],
  ...extra,
})

const stubGraph = (designsById: Record<string, any>, storeCurrency = "aud") => {
  graph.mockImplementation(async ({ entity, filters }: any) => {
    if (entity === "store") {
      return {
        data: [
          {
            id: "store_1",
            supported_currencies: [
              { currency_code: "usd", is_default: false },
              { currency_code: storeCurrency, is_default: true },
            ],
          },
        ],
      }
    }
    if (entity === "design") {
      const d = designsById[filters?.id]
      return { data: d ? [d] : [] }
    }
    return { data: [] }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  createProductFromDesignWorkflow.mockReturnValue({ run: createProductRun } as any)
  createProductRun.mockResolvedValue({
    result: { product_id: "prod_new", variant_id: "var_new" },
  })
  updateDesignRun.mockResolvedValue({ result: {} })
})

describe("resolveApprovalCurrency", () => {
  /**
   * 🔴 The approve route listed every design in USD on a platform trading in
   * AUD and INR.
   */
  it("prefers what the design was costed in", () => {
    expect(
      resolveApprovalCurrency({ designCurrency: "INR", storeCurrency: "aud" })
    ).toBe("inr")
  })

  it("falls back to the store, then to usd", () => {
    expect(resolveApprovalCurrency({ storeCurrency: "AUD" })).toBe("aud")
    expect(resolveApprovalCurrency({})).toBe("usd")
  })
})

describe("applyRunApprovals — approving", () => {
  /**
   * 🔴 THE rule. `create-product-from-design` appends another
   * "Custom - <name>" variant when a design already has a product, so two
   * completed runs of one design — parent/child assignments, recreations —
   * would list the same design twice, silently, across a whole selection.
   */
  it("creates ONE product for two runs of the same design", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1"),
      completedRun("run_2", "des_1"),
    ])
    stubGraph({ des_1: design("des_1") })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1", "run_2"],
      decision: "approve",
    })

    expect(createProductRun).toHaveBeenCalledTimes(1)
    expect(result.approved).toEqual(["run_1", "run_2"])
    expect(result.created_product_ids).toEqual(["prod_new"])
    // Both runs record the SAME product.
    expect(result.runs.map((r) => r.product_id)).toEqual(["prod_new", "prod_new"])
  })

  /** Running it again must create nothing — the second half of idempotency. */
  it("creates nothing when the design already has a product", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({
      des_1: design("des_1", {
        products: [{ id: "prod_existing", variants: [{ id: "var_existing" }] }],
      }),
    })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    expect(createProductRun).not.toHaveBeenCalled()
    expect(result.created_product_ids).toEqual([])
    expect(result.runs[0]).toMatchObject({
      outcome: "approved",
      product_id: "prod_existing",
      variant_id: "var_existing",
      product_existed: true,
    })
  })

  it("lists the product in the design's currency, not usd", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: "inr" }) })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(createProductRun.mock.calls[0][0].input).toMatchObject({
      design_id: "des_1",
      currency_code: "inr",
      estimated_cost: 850,
    })
  })

  it("falls back to the store's default currency", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: null }) }, "aud")

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(createProductRun.mock.calls[0][0].input.currency_code).toBe("aud")
  })

  /**
   * 🔑 Partners are notified off `design.approved`. A 40-run batch over 5
   * designs must send 5 notifications, not 40 — and none for a design whose
   * product was already there, because nothing new was approved.
   */
  it("emits design.approved once per newly approved design", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1"),
      completedRun("run_2", "des_1"),
      completedRun("run_3", "des_2"),
    ])
    stubGraph({
      des_1: design("des_1"),
      des_2: design("des_2", {
        products: [{ id: "prod_existing", variants: [] }],
      }),
    })

    await applyRunApprovals(container, {
      runIds: ["run_1", "run_2", "run_3"],
      decision: "approve",
    })

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].data.design_id).toBe("des_1")
  })

  it("records the decision on every run of the design", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1"),
      completedRun("run_2", "des_1"),
    ])
    stubGraph({ des_1: design("des_1") })

    await applyRunApprovals(container, {
      runIds: ["run_1", "run_2"],
      decision: "approve",
      actorId: "user_1",
    })

    const written = updateProductionRuns.mock.calls.map((c) => c[0])
    expect(written.map((w) => w.id)).toEqual(["run_1", "run_2"])
    for (const w of written) {
      expect(w.approval_decision).toBe("approved")
      expect(w.approved_product_id).toBe("prod_new")
      expect(w.approval_decided_by).toBe("user_1")
    }
  })
})

describe("applyRunApprovals — refusing what it must not decide", () => {
  it("skips a run that is not completed, and says why", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1", { status: "in_progress" }),
    ])
    stubGraph({ des_1: design("des_1") })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    expect(result.skipped).toEqual(["run_1"])
    expect(result.runs[0].reason).toMatch(/in_progress/)
    expect(createProductRun).not.toHaveBeenCalled()
  })

  it("skips a run that was already decided", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1", {
        approval_decision: "rejected",
        approved_product_id: null,
      }),
    ])
    stubGraph({ des_1: design("des_1") })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    expect(result.skipped).toEqual(["run_1"])
    expect(result.runs[0].reason).toMatch(/Already rejected/)
    expect(updateProductionRuns).not.toHaveBeenCalled()
  })

  it("reports an unknown run as failed rather than throwing the batch away", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1") })

    const result = await applyRunApprovals(container, {
      runIds: ["run_missing", "run_1"],
      decision: "approve",
    })

    expect(result.failed).toEqual(["run_missing"])
    expect(result.approved).toEqual(["run_1"])
  })

  /**
   * 🔴 An empty list must never reach the service: an absent id filter means
   * ALL rows, and a decision applied to every run on the platform is the one
   * mistake this must be incapable of.
   */
  it("never queries with an empty id list", async () => {
    const result = await applyRunApprovals(container, {
      runIds: [],
      decision: "approve",
    })

    expect(listProductionRuns).not.toHaveBeenCalled()
    expect(result.runs).toEqual([])
  })

  it("isolates a design whose product creation throws", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1"),
      completedRun("run_2", "des_2"),
    ])
    stubGraph({ des_1: design("des_1"), des_2: design("des_2") })
    createProductRun
      .mockRejectedValueOnce(new Error("price set write failed"))
      .mockResolvedValueOnce({
        result: { product_id: "prod_2", variant_id: "var_2" },
      })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1", "run_2"],
      decision: "approve",
    })

    expect(result.failed).toEqual(["run_1"])
    expect(result.approved).toEqual(["run_2"])
    expect(result.runs[0].reason).toMatch(/price set write failed/)
  })
})

describe("applyRunApprovals — rejecting", () => {
  it("creates no product and records the reason", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1") })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "reject",
      reason: "Dye lot off-shade",
      actorId: "user_1",
    })

    expect(createProductRun).not.toHaveBeenCalled()
    expect(result.rejected).toEqual(["run_1"])

    const [written] = updateProductionRuns.mock.calls[0]
    expect(written.approval_decision).toBe("rejected")
    expect(written.approval_reason).toBe("Dye lot off-shade")
    // 🔴 The run stays COMPLETED. The partner made the goods and is still owed
    // for produced_quantity; billing keys on that status.
    expect("status" in written).toBe(false)
  })

  /** A run with no design can still be refused — there is just nothing to make. */
  it("can reject a run that has no design behind it", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", null)])
    stubGraph({})

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "reject",
      reason: "Wrong goods",
    })

    expect(result.rejected).toEqual(["run_1"])
  })

  it("skips approving a run that has no design", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", null)])
    stubGraph({})

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    expect(result.skipped).toEqual(["run_1"])
    expect(result.runs[0].reason).toMatch(/no design/)
  })
})

describe("applyRunApprovals — dry run", () => {
  /** Shows the shape of the batch and writes nothing (#1803's lesson). */
  it("reports what would happen and creates nothing", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1"),
      completedRun("run_2", "des_1"),
      completedRun("run_3", "des_2"),
    ])
    stubGraph({
      des_1: design("des_1"),
      des_2: design("des_2", {
        products: [{ id: "prod_existing", variants: [{ id: "var_e" }] }],
      }),
    })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1", "run_2", "run_3"],
      decision: "approve",
      dryRun: true,
    })

    expect(createProductRun).not.toHaveBeenCalled()
    expect(updateProductionRuns).not.toHaveBeenCalled()
    expect(updateDesignRun).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()

    expect(result.dry_run).toBe(true)
    expect(result.approved).toEqual(["run_1", "run_2", "run_3"])
    // The one thing an operator most needs to see BEFORE deciding: which of
    // these designs already has a product.
    expect(result.runs.map((r) => r.product_existed)).toEqual([false, false, true])
    expect(result.design_ids).toEqual(["des_1", "des_2"])
  })
})
