import {
  FIXERS,
  MAX_ITEMS,
  SWEEP_JOB_ID,
  pairFromNodeKey,
  pairNode,
  resolveDanglingPointers,
} from "../dangling-pointers"

/**
 * The dangling-pointer board (#1857).
 *
 * Everything worth checking here is a judgement the board makes about a pair,
 * and none of it is visible from a screenshot: which state a node draws, which
 * nodes earn a button, and — the one that matters most — that the button which
 * WRITES is never the button that previews.
 */

const change = (over: Record<string, unknown> = {}) => ({
  entity: "dangling",
  id: "payment_schedule.cart_id",
  field: "→ cart",
  before: 23,
  after: 27,
  note: "23 of 27 point at a cart that is not visible (85%) · e.g. `cart_e2e_1787467149960`",
  ...over,
})

const scopeWith = (runs: any[]) => ({
  resolve: () => ({
    listOpsMaintenanceRuns: async () => runs,
  }),
})

describe("pairNode", () => {
  it("draws an unexplained pair as absent, which is what makes it red", () => {
    const n = pairNode(change())
    expect(n.state).toBe("absent")
    expect(n.status).toBe("unexplained")
    expect(n.count).toBe(23)
    expect(n.props.find((p) => p.key === "Rate")?.value).toBe("85%")
  })

  /*
   * 🔴 A classified pair must NOT draw red. Both `revokeQuote` deleting its
   * price list and a variant price save replacing its price set are correct
   * terminal states; ranking them beside the real defects is precisely the
   * failure the sweep was rewritten to remove, and it would come straight back
   * if the board coloured every non-resolving pointer the same.
   */
  it("does not draw an explained pair as absent", () => {
    const n = pairNode(change({ entity: "known:tombstone", id: "partner_quote.price_list_id" }))
    expect(n.state).toBe("derived")
    expect(n.status).toBe("tombstone")
  })

  it("offers no act on a pair nobody has written a fixer for", () => {
    expect(pairNode(change()).act).toBeNull()
  })

  it("offers the written fixer on the one pair that has one", () => {
    const n = pairNode(
      change({ id: "pricing_price_fx_rates_fx_price_meta.price_id", entity: "known:tombstone" })
    )
    expect(n.act?.path).toBe("/admin/ops/maintenance-jobs/compact-fx-price-meta/run")
  })

  /*
   * 🔴 Found by RENDERING, not by any test that existed. The canvas draws
   * `sublabel ?? count`, so a sublabel of just the target hid the number on
   * every node — and a board that ranks by row count drew 21 identical boxes.
   */
  it("puts the row count where the canvas will actually draw it", () => {
    expect(pairNode(change()).sublabel).toBe("23 of 27 → cart")
  })

  it("survives a pair with no rows rather than dividing by zero", () => {
    const n = pairNode(change({ before: 0, after: 0 }))
    expect(n.props.find((p) => p.key === "Rate")?.value).toBe("0%")
  })
})

/**
 * 🔴 The invariant the whole affordance rests on.
 *
 * The reason `NodeAct` carries two named bodies instead of one body plus a
 * flag is that a client which mutates `dry_run` is one typo away from applying
 * what the reader asked to preview — and that typo is invisible in review. If
 * the two bodies were ever equal the type would still compile, the UI would
 * still render two buttons, and the safe press would write.
 */
describe("preview is never the apply", () => {
  it("every fixer previews with dry_run true and applies with dry_run false", () => {
    for (const key of Object.keys(FIXERS)) {
      const n = pairNode(change({ id: key }))
      expect(n.act).toBeTruthy()
      expect(n.act!.previewBody).toEqual({ dry_run: true })
      expect(n.act!.applyBody).toEqual({ dry_run: false })
      expect(n.act!.previewBody).not.toEqual(n.act!.applyBody)
    }
  })

  it("every fixer says what applying does, in words the server owns", () => {
    for (const [key, f] of Object.entries(FIXERS)) {
      // A generic "Are you sure?" is what this field exists to prevent.
      expect(f.confirm.length).toBeGreaterThan(40)
      expect(key).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+_id$/)
    }
  })

  /*
   * 🔴 The board must never grow a fixer that can act on any pair. Three
   * sweeps running were topped by a pair that was not a defect; a job that
   * nulls whatever ranked first would have destroyed correct state on all
   * three and looked like tidying up. Every entry names ONE column.
   */
  it("has no generic fixer", () => {
    for (const f of Object.values(FIXERS)) {
      expect(f.job).not.toMatch(/generic|any|all/i)
    }
  })
})

describe("pairFromNodeKey", () => {
  it("splits on the last dot, so a schema-ish table name survives", () => {
    expect(pairFromNodeKey("pair:pricing_price_fx_rates_fx_price_meta.price_id")).toEqual({
      table: "pricing_price_fx_rates_fx_price_meta",
      column: "price_id",
    })
  })

  it("refuses anything that is not a pair node", () => {
    expect(pairFromNodeKey("sweep")).toBeNull()
    expect(pairFromNodeKey("pair:no_dot")).toBeNull()
    expect(pairFromNodeKey("pair:.leading")).toBeNull()
    expect(pairFromNodeKey("pair:trailing.")).toBeNull()
  })
})

describe("resolveDanglingPointers", () => {
  /*
   * 🔴 The single most dangerous thing this board could say is nothing. An
   * empty canvas after a page that has never been swept is indistinguishable
   * from a clean database, and a reader would take the reassuring reading.
   */
  it("says NO SWEEP rather than drawing an empty, reassuring board", async () => {
    const g = await resolveDanglingPointers({ scope: scopeWith([]), id: "dangling-pointers" })
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0].label).toBe("No sweep recorded")
    expect(g.spine.sublabel).toBe("never swept")
    /*
     * 🔴 The BOARD is never `absent` — only its findings are. The drawer
     * badges an absent node with the red word "absent", and a spine carrying
     * it introduced the board as "Dangling pointers · absent", which is not a
     * statement about anything. Found by rendering.
     */
    expect(g.spine.state).toBe("present")
    expect(g.nodes[0].state).toBe("absent")
    expect(g.edges[0].reason).toContain("not a statement that nothing dangles")
  })

  it("offers to run the sweep, and the sweep has nothing to apply", async () => {
    const g = await resolveDanglingPointers({ scope: scopeWith([]), id: "dangling-pointers" })
    expect(g.spine.act?.path).toBe(`/admin/ops/maintenance-jobs/${SWEEP_JOB_ID}/run`)
    // Read-only in both modes — a disabled "Apply" would imply a write exists.
    expect(g.spine.act?.applyBody).toBeNull()
  })

  it("draws one node per measured pair and keeps the sweep's own sentence", async () => {
    const g = await resolveDanglingPointers({
      scope: scopeWith([
        {
          id: "run_1",
          actor_id: "user_1",
          summary: "2 unexplained pair(s)",
          created_at: "2026-09-07T02:00:00.000Z",
          changes: [change(), change({ id: "lead.form_id", entity: "known:external_id" })],
        },
      ]),
      id: "dangling-pointers",
    })

    expect(g.nodes.map((n) => n.key)).toEqual([
      "pair:payment_schedule.cart_id",
      "pair:lead.form_id",
    ])
    // Verbatim, so the sentence has one home and the sample value survives.
    expect(g.edges[0].reason).toContain("cart_e2e_1787467149960")
    expect(g.summary.absent).toBe(1)
    expect(g.summary.derived).toBe(1)
  })

  /*
   * 🔴 A count with no time attached is what let a LOCAL sweep get written
   * into a handoff as a fact about production. The board states when, and who.
   */
  it("states when it was swept and by whom", async () => {
    const g = await resolveDanglingPointers({
      scope: scopeWith([
        {
          id: "run_1",
          actor_id: "user_42",
          summary: "clean",
          created_at: "2026-09-07T02:00:00.000Z",
          changes: [],
        },
      ]),
      id: "dangling-pointers",
    })
    expect(g.spine.props.find((p) => p.key === "Last swept")?.value).toContain("2026-09-07")
    expect(g.spine.props.find((p) => p.key === "Ran by")?.value).toBe("user_42")
    expect(g.spine.state).toBe("present")
    expect(g.spine.sublabel).toContain("swept 2026-09-07")
  })

  it("caps the evidence it will list", () => {
    expect(MAX_ITEMS).toBeLessThanOrEqual(100)
  })
})
