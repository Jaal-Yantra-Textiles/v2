const runWorkflow = jest.fn()
const createProductFromDesignWorkflow = jest.fn(() => ({ run: createProductRun }))
const createProductRun = jest.fn()
const updateDesignRun = jest.fn().mockResolvedValue({ result: {} })

jest.mock("../../designs/create-product-from-design", () => ({
  createProductFromDesignWorkflow: (...a: any[]) =>
    (createProductFromDesignWorkflow as any)(...a),
  // The REAL helper — the photo gate must be exercised, not stubbed. Stubbing
  // it would make every assertion below about the mock instead of the rule.
  resolveDesignGallery: jest.requireActual(
    "../../designs/create-product-from-design"
  ).resolveDesignGallery,
  // Likewise real: the size a batch of runs agrees on is a RULE (#2030 item 3),
  // and stubbing it would make the assertion below about the stub.
  resolveRunsSizeLabel: jest.requireActual(
    "../../designs/create-product-from-design"
  ).resolveRunsSizeLabel,
}))
jest.mock("../../designs/update-design", () => ({
  __esModule: true,
  default: () => ({ run: updateDesignRun }),
}))
jest.mock("../../../modules/production_runs", () => ({
  PRODUCTION_RUNS_MODULE: "production_runs",
}))
/**
 * The fanout helper is deliberately NOT mocked. It is the thing that scopes the
 * job to the HOUSE store (#1979) and refuses an empty payload, and a stub would
 * make every assertion below about the stub. Its `fx.fanout_requested` event is
 * the observable — counting those events is what proves the batching.
 */
const fanoutEvents = () =>
  emit.mock.calls
    .map((c: any[]) => c[0])
    .filter((e: any) => e?.name === "fx.fanout_requested")

import {
  applyRunApprovals,
  resolveApprovalCurrency,
} from "../approve-run-output"

const listProductionRuns = jest.fn()
const updateProductionRuns = jest.fn().mockResolvedValue({})
const graph = jest.fn()
const emit = jest.fn().mockResolvedValue(undefined)
/**
 * A STABLE logger, not a fresh `jest.fn()` per resolve — otherwise a test can
 * never see what was logged, and #1979's "the currency was assumed" warning is
 * the only signal that a price was guessed rather than read.
 */
const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const container = {
  resolve: (key: string) => {
    if (key === "production_runs") {
      return { listProductionRuns, updateProductionRuns }
    }
    if (key === "query") return { graph }
    if (key === "logger") return logger
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

/** A folder of shoot images, the evidence Commerce_Ready is gated on. */
const shot = (n = 2) => [
  {
    id: "fold_1",
    media_files: Array.from({ length: n }, (_, i) => ({
      id: `mf_${i}`,
      file_path: `https://cdn/shoot-${i}.jpg`,
      file_type: "image",
    })),
  },
]

/**
 * A design the graph answers with. `products: []` = never approved.
 *
 * `design_variants` is the design↔variant LINK table, kept separate from the
 * product's `variants` on purpose: a product carries one variant per design
 * minted onto it, and only the link says which of them is THIS design's. A
 * fixture that conflates the two cannot express the shared product that #2070
 * made ordinary — see "picks the design's own variant".
 */
const design = (id: string, extra: any = {}) => ({
  id,
  name: `Design ${id}`,
  estimated_cost: 850,
  cost_currency: "inr",
  products: [],
  design_variants: [],
  ...extra,
})

/**
 * A MULTI-TENANT store table, because that is what prod is: 13 stores, 12 of
 * them partner tenants carrying `metadata.partner_id`. The partner row is
 * deliberately FIRST — the read this replaced took `stores[0]`, so a stub with
 * a single store could never have caught #1979.
 */
const stubGraph = (
  designsById: Record<string, any>,
  storeCurrency = "aud",
  houseCurrencies: string[] = ["usd", "inr", "aud", "eur"]
) => {
  graph.mockImplementation(async ({ entity, filters }: any) => {
    if (entity === "store") {
      return {
        data: [
          {
            id: "store_partner_first",
            metadata: { partner_id: "01PARTNER" },
            supported_currencies: [{ currency_code: "idr", is_default: true }],
          },
          {
            id: "store_1",
            metadata: null,
            supported_currencies: houseCurrencies.map((c) => ({
              currency_code: c,
              is_default: c === storeCurrency,
            })),
          },
        ],
      }
    }
    if (entity === "design") {
      const d = designsById[filters?.id]
      return { data: d ? [d] : [] }
    }
    if (entity === "design_product_variant") {
      const d = designsById[filters?.design_id]
      return {
        data: (d?.design_variants ?? []).map((v: string) => ({
          product_variant_id: v,
        })),
      }
    }
    if (entity === "product_variant") {
      // Only reached when the chosen variant sits on no product the design
      // links to — every other case is answered from the design read itself.
      return { data: [] }
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
    expect(resolveApprovalCurrency({ designCurrency: "INR" })).toBe("inr")
  })

  it("falls back to INR — never usd (#1914), never the store (#1979)", () => {
    /*
     * "usd" survived the original fix as the last resort, which still
     * mis-priced any design that never recorded a currency. Production is
     * costed in INR (the unified order carries `currency_assumed: true` for
     * the same reason).
     *
     * #1979: the STORE default used to sit in front of that fallback, so on a
     * EUR store the INR last resort could never be reached and an INR-costed
     * design minted at ~110x. The store is no longer consulted at all.
     */
    expect(resolveApprovalCurrency({})).toBe("inr")
    expect(resolveApprovalCurrency({})).not.toBe("usd")
    expect(resolveApprovalCurrency({ storeCurrency: "EUR" } as any)).toBe("inr")
  })
})

describe("applyRunApprovals — the design's status after approval", () => {
  /**
   * #1920 — approving run output is the moment a design has been PRODUCED,
   * reviewed, and minted into a product. That is what `Commerce_Ready` meant.
   * Nothing ever set it: the only writer was a subscriber on `design.updated`,
   * an event this codebase does not emit, so 0 of 123 prod designs had reached
   * it. This transition is the one that fixes that, so it is asserted here —
   * the suite passed either way before, which is how it went unnoticed.
   */
  it("moves a PHOTOGRAPHED design to Commerce_Ready, not Approved", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { folders: shot() }) })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(updateDesignRun).toHaveBeenCalledWith({
      input: { id: "des_1", status: "Commerce_Ready" },
    })
  })

  it("sets it once for two runs of the same design, not once per run", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1"),
      completedRun("run_2", "des_1"),
    ])
    stubGraph({ des_1: design("des_1", { folders: shot() }) })

    await applyRunApprovals(container, {
      runIds: ["run_1", "run_2"],
      decision: "approve",
    })

    const commerceReadyCalls = updateDesignRun.mock.calls.filter(
      (c: any[]) => c[0]?.input?.status === "Commerce_Ready"
    )
    expect(commerceReadyCalls).toHaveLength(1)
  })

  /**
   * 🔴 The gate. A produced garment with no photographs cannot be sold, so
   * approval alone must NOT mark it sellable — it stays `Approved` and waits
   * for the shoot. This is the case that keeps the transition honest.
   */
  it("leaves an UNPHOTOGRAPHED design at Approved", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1") })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(updateDesignRun).toHaveBeenCalledWith({
      input: { id: "des_1", status: "Approved" },
    })
  })

  it("does not count a folder of non-images as a shoot", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({
      des_1: design("des_1", {
        folders: [
          {
            id: "fold_1",
            media_files: [
              { id: "mf_0", file_path: "https://cdn/tech-pack.pdf", file_type: "document" },
            ],
          },
        ],
      }),
    })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(updateDesignRun).toHaveBeenCalledWith({
      input: { id: "des_1", status: "Approved" },
    })
  })

  it("touches no status on a dry run", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1") })

    await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
      dryRun: true,
    })

    expect(updateDesignRun).not.toHaveBeenCalled()
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
        design_variants: ["var_existing"],
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

  /**
   * 🔴 THE defect. `design.products[0].variants[0]` is the PRODUCT's first
   * variant, and a product minted from one design and appended to by another
   * carries one variant per design. Row 0 is then a different garment, at a
   * different price — stamped onto this run as `approved_variant_id` and
   * fulfilled against later.
   *
   * The fixture is deliberately shaped so `[0]` is WRONG: `var_other_design`
   * comes first because it was minted first. Before this fix the assertion
   * below read `var_other_design` and nobody would have seen it — the outcome
   * is still "approved" and the product id is still right.
   *
   * Rare only until #2070: the append that creates a shared product had been
   * failing silently, so shared products barely existed. It works now.
   */
  it("picks the design's OWN variant on a product shared with another design", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_mine")])
    stubGraph({
      des_mine: design("des_mine", {
        products: [
          {
            id: "prod_shared",
            variants: [{ id: "var_other_design" }, { id: "var_mine" }],
          },
        ],
        design_variants: ["var_mine"],
      }),
    })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    expect(result.runs[0]).toMatchObject({
      outcome: "approved",
      product_id: "prod_shared",
      variant_id: "var_mine",
      product_existed: true,
    })
    expect(result.runs[0].variant_id).not.toBe("var_other_design")
    // And the run is stamped with it — this is what fulfilment reads.
    expect(updateProductionRuns).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run_1", approved_variant_id: "var_mine" })
    )
  })

  /**
   * The order of authority, identical to `resolveRunVariant`: what the RUN says
   * it made beats what the design happens to link to. A design with S and M is
   * ambiguous; the run that made the M is not.
   */
  it("prefers the run's own variant_id over the design link", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1", { variant_id: "var_m" }),
    ])
    stubGraph({
      des_1: design("des_1", {
        products: [
          { id: "prod_existing", variants: [{ id: "var_s" }, { id: "var_m" }] },
        ],
        design_variants: ["var_s", "var_m"],
      }),
    })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    expect(result.runs[0]).toMatchObject({
      product_id: "prod_existing",
      variant_id: "var_m",
    })
  })

  /**
   * 🔴 A refusal, not a guess. Two variants and no run naming one cannot be
   * answered — and `approved_variant_id: null` is a state an operator can see
   * and repair, which a confident wrong id is not. The approval itself still
   * stands: the runs are decided and the product is recorded.
   */
  it("refuses to name a variant when the design has two and no run says which", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({
      des_1: design("des_1", {
        products: [
          { id: "prod_existing", variants: [{ id: "var_s" }, { id: "var_m" }] },
        ],
        design_variants: ["var_s", "var_m"],
      }),
    })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    expect(result.runs[0]).toMatchObject({
      outcome: "approved",
      product_id: "prod_existing",
      variant_id: null,
    })
    // Said out loud, with the repair in it — silence here is the whole problem.
    expect(result.runs[0].reason).toContain("var_s")
    expect(result.runs[0].reason).toContain("variant_id")
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("approved without a variant")
    )
  })

  /**
   * Two runs of one design that made different variants cannot share ONE
   * design-level variant — but each run still said perfectly clearly what it
   * produced, and PR3 (#1970) stamps each with its own.
   *
   * Before PR3 both came back `variant_id: null`, because the design-level
   * refusal was applied to every run of the design. `approved_variant_id` is
   * what a fulfilment is later filed against, so nulling it on a run that
   * answered is how a produced garment becomes unfulfillable.
   */
  it("stamps each run with ITS OWN variant when the runs disagree", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1", { variant_id: "var_s" }),
      completedRun("run_2", "des_1", { variant_id: "var_m" }),
    ])
    stubGraph({
      des_1: design("des_1", {
        products: [
          { id: "prod_existing", variants: [{ id: "var_s" }, { id: "var_m" }] },
        ],
        design_variants: ["var_s", "var_m"],
      }),
    })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1", "run_2"],
      decision: "approve",
    })

    expect(result.approved).toEqual(["run_1", "run_2"])
    expect(result.runs.map((r) => r.variant_id)).toEqual(["var_s", "var_m"])
    expect(result.runs.map((r) => r.variant_source)).toEqual(["run", "run"])

    // Persisted per run, not just reported per run.
    const stamped = updateProductionRuns.mock.calls
      .map((c: any[]) => c[0])
      .filter((u: any) => u?.approval_decision === "approved")
      .map((u: any) => [u.id, u.approved_variant_id])
    expect(stamped).toEqual([
      ["run_1", "var_s"],
      ["run_2", "var_m"],
    ])

    /**
     * A run that answered for itself is not suffering the design's ambiguity,
     * so it does not carry the design-level refusal note.
     */
    expect(result.runs[0].reason).toBeUndefined()
  })

  /**
   * 🔑 ONE fanout for the batch, not one per design (PR3, #1970).
   *
   * `requestVariantPriceFanout` emits a job per call, and the handler is a
   * subscriber, so five designs used to wake the worker five times to walk the
   * same currency list. Running it on the REQUEST path OOM-killed prod twice on
   * 2026-08-19, which is why the count matters rather than just the result.
   */
  it("requests ONE price fanout for the whole batch", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1"),
      completedRun("run_2", "des_2"),
    ])
    stubGraph({ des_1: design("des_1"), des_2: design("des_2") })
    createProductRun
      .mockResolvedValueOnce({ result: { product_id: "prod_a", variant_id: "var_a" } })
      .mockResolvedValueOnce({ result: { product_id: "prod_b", variant_id: "var_b" } })

    await applyRunApprovals(container, {
      runIds: ["run_1", "run_2"],
      decision: "approve",
    })

    const jobs = fanoutEvents()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].data.variant_ids).toEqual(["var_a", "var_b"])
    expect(jobs[0].data.store_id).toBe("store_1")
  })

  it("asks for no fanout at all when nothing was minted", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({
      des_1: design("des_1", {
        products: [{ id: "prod_existing", variants: [{ id: "var_s" }] }],
        design_variants: ["var_s"],
      }),
    })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(fanoutEvents()).toHaveLength(0)
  })

  /**
   * 🔴 What the `product_existed` boolean could never say. A design re-approved
   * at a DIFFERENT price and one re-approved at the SAME price both reported
   * `product_existed: true` and looked like clean idempotency — while the
   * listing went on selling at the old number.
   */
  it("reports a reused listing whose price no longer matches, and does NOT reprice it", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({
      des_1: design("des_1", {
        estimated_cost: 1000, // -> a computed price above the listed 9000
        products: [
          {
            id: "prod_existing",
            variants: [
              { id: "var_s", prices: [{ amount: 9000, currency_code: "inr" }] },
            ],
          },
        ],
        design_variants: ["var_s"],
      }),
    })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    const row = result.runs[0]
    expect(row.reconcile).toMatchObject({
      product: "reused",
      variant: "reused",
      listed_price_before: 9000,
      price_stale: true,
    })
    expect(row.listed_price).not.toBe(9000)
    // Said out loud — a computed price that is silently discarded is the bug.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("was NOT repriced")
    )
    // Reported, never written: no product/variant creation was attempted.
    expect(createProductRun).not.toHaveBeenCalled()
  })

  it("reports a fresh mint as created, with no stale-price claim", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1") })

    const result = await applyRunApprovals(container, {
      runIds: ["run_1"],
      decision: "approve",
    })

    expect(result.runs[0].reconcile).toEqual({
      product: "created",
      variant: "created",
    })
    expect(result.runs[0].variant_source).toBe("design")
  })

  it("lists the product in the design's currency, not usd", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: "inr" }) })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    /*
     * 850 is the design's estimate; 1190 is that estimate marked up (#1914).
     * This fixture logs no consumption, so `cost_per_unit` is null and the
     * estimate is the only cost available — the run's own cost would win if it
     * had one. The listed price is never the bare cost: that was selling at
     * cost, which is what the markup exists to stop.
     */
    expect(createProductRun.mock.calls[0][0].input).toMatchObject({
      design_id: "des_1",
      currency_code: "inr",
      estimated_cost: 1190,
    })
  })

  /**
   * 🔴 #1979 — this test used to assert "aud", pinning the bug in place: a
   * design with no `cost_currency` inherited the STORE's default. On the live
   * EUR store that minted ₹2,634.75 as €2,634.75, ~110x its cost, and the
   * INR last resort written for exactly this case was unreachable.
   *
   * The store is stubbed as AUD here precisely so a re-introduced
   * `|| storeCurrency` would turn this red again.
   */
  /**
   * 🔴 #2030 item 3 — the RUNS' size reaches the mint.
   *
   * Order 89's shape: the design states S and M (ambiguous, so the design-level
   * rule abstains) while the runs that made the garment snapshot [M]. Without
   * this the product minted a variant with no size at all, and the order line
   * bound to it — which is how order 89 has read "Small" since September while
   * every run says Medium.
   */
  it("passes the size the RUNS agree on, beating an ambiguous design", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1", {
        snapshot: { design: { name: "D" }, size_sets: [{ size_label: "M" }] },
      }),
    ])
    stubGraph({
      des_1: design("des_1", {
        size_sets: [{ size_label: "S" }, { size_label: "M" }],
      }),
    })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(createProductRun.mock.calls[0][0].input.size_label).toBe("M")
  })

  it("passes no size when the runs disagree — a product cannot be both", async () => {
    listProductionRuns.mockResolvedValue([
      completedRun("run_1", "des_1", {
        snapshot: { design: { name: "D" }, size_sets: [{ size_label: "S" }] },
      }),
      completedRun("run_2", "des_1", {
        snapshot: { design: { name: "D" }, size_sets: [{ size_label: "M" }] },
      }),
    ])
    stubGraph({ des_1: design("des_1") })

    await applyRunApprovals(container, {
      runIds: ["run_1", "run_2"],
      decision: "approve",
    })

    expect(createProductRun.mock.calls[0][0].input.size_label).toBeNull()
  })

  it("ignores the store default for a design that never stated a currency", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: null }) }, "aud")

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(createProductRun.mock.calls[0][0].input.currency_code).toBe("inr")
    expect(createProductRun.mock.calls[0][0].input.currency_code).not.toBe("aud")
  })

  it("scopes the FX fanout to the HOUSE store, not the first row", async () => {
    /*
     * 🔴 `stores[0]` here is a PARTNER tenant. Scoping the fanout to it would
     * materialise prices against another tenant's currency set (#1979/#1983).
     */
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: "inr" }) })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    const fanout = emit.mock.calls.filter(
      (c: any[]) => c[0]?.name === "fx.fanout_requested"
    )
    expect(fanout).toHaveLength(1)
    expect(fanout[0][0].data.store_id).toBe("store_1")
    expect(fanout[0][0].data.store_id).not.toBe("store_partner_first")
  })

  it("warns when the price is in a currency the house store cannot sell", async () => {
    /*
     * A GUARD, never an override. The live instance: `Le Ciricotte` does not
     * enable INR at all, so an INR-costed design gets a correct price that the
     * store cannot actually sell. The currency must NOT be swapped — doing that
     * silently re-denominates ₹2,634.75 as €2,634.75, which IS #1979.
     */
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: "inr" }) }, "eur", ["eur", "gbp"])

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    const warned = (logger.warn as jest.Mock).mock.calls
      .map((c: any[]) => String(c[0]))
      .filter((m: string) => m.includes("does not sell in"))
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain("inr")

    // and the price it actually wrote is STILL inr — warned, not rewritten
    expect(createProductRun.mock.calls[0][0].input.currency_code).toBe("inr")
  })

  it("does not warn when the house store enables the currency", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: "inr" }) })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(
      (logger.warn as jest.Mock).mock.calls
        .map((c: any[]) => String(c[0]))
        .filter((m: string) => m.includes("does not sell in"))
    ).toHaveLength(0)
  })

  it("says out loud that the currency was assumed", async () => {
    /*
     * The price is still written — refusing would block every approval — so
     * the warning is the only signal that a number was guessed. 42 of 43
     * costed designs on prod were in this state.
     */
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: null }) }, "aud")

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    const warned = (logger.warn as jest.Mock).mock.calls
      .map((c: any[]) => String(c[0]))
      .filter((m: string) => m.includes("no cost_currency"))
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain("des_1")
    expect(warned[0]).toContain("inr")
  })

  it("does not warn when the design stated its currency", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: "inr" }) }, "aud")

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(
      (logger.warn as jest.Mock).mock.calls
        .map((c: any[]) => String(c[0]))
        .filter((m: string) => m.includes("no cost_currency"))
    ).toHaveLength(0)
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

    /*
     * Count design.approved SPECIFICALLY, not every emit. Approval now also
     * asks for the FX fanout (#1914), so a bare call count measures two
     * different events with one number and would fail for a reason that has
     * nothing to do with partner notifications.
     */
    const approved = emit.mock.calls.filter(
      (c: any[]) => c[0]?.name === "design.approved"
    )
    expect(approved).toHaveLength(1)
    expect(approved[0][0].data.design_id).toBe("des_1")
  })

  /**
   * 🔴 #1900's single-currency defect, at its source.
   *
   * Medusa's pricing module emits no `price.created` event, so every path that
   * writes a variant price must ASK for the fanout. Only the partner routes
   * ever did — the design -> product path emitted nothing, so every
   * design-approved product was listed in exactly one currency and read as
   * "not available" in every other region.
   */
  it("asks for the FX fanout on a product it created", async () => {
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({ des_1: design("des_1", { cost_currency: "inr" }) })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    const fanout = emit.mock.calls.filter(
      (c: any[]) => c[0]?.name === "fx.fanout_requested"
    )
    expect(fanout).toHaveLength(1)
    expect(fanout[0][0].data.variant_ids).toEqual(["var_new"])
  })

  it("does NOT ask for a fanout when the product already existed", async () => {
    // Nothing was priced, so there is nothing to convert — and waking the
    // worker for an empty job is what the helper's own guard avoids.
    listProductionRuns.mockResolvedValue([completedRun("run_1", "des_1")])
    stubGraph({
      des_1: design("des_1", {
        products: [{ id: "prod_existing", variants: [{ id: "var_existing" }] }],
        design_variants: ["var_existing"],
      }),
    })

    await applyRunApprovals(container, { runIds: ["run_1"], decision: "approve" })

    expect(
      emit.mock.calls.filter((c: any[]) => c[0]?.name === "fx.fanout_requested")
    ).toHaveLength(0)
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
        design_variants: ["var_e"],
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
