import {
  actionOf,
  buildDesignChangeNotice,
  isReassuring,
  PRODUCTION_STATE_LABELS,
  productionStateOf,
  nextItemMetadata,
  readProducedQuantity,
  type DesignChange,
} from "../lib/design-change-notice"

/**
 * #1918 — the honesty of the "your designs changed" email.
 *
 * The worked example throughout is Aline's real order
 * (order_01KNP520PT94BN8SC0JKZ6ZVJ9): 5 design items, €335 captured, and
 * exactly ONE production run — for the skirt that already shipped. Four
 * garments are owed with no run at all.
 */

const change = (o: Partial<DesignChange>): DesignChange => ({
  line_item_id: "ordli_x",
  item_title: "Thing",
  previous_design: { id: "d_old", name: "Old" },
  new_design: { id: "d_new", name: "New" },
  run: null,
  ...o,
})

describe("productionStateOf", () => {
  it("completed means MADE even when produced_quantity is null", () => {
    // 12 parent runs in prod had a null produced_quantity while genuinely
    // having produced goods. Requiring the quantity would tell a customer their
    // finished garment was never started.
    expect(productionStateOf({ status: "completed", produced_quantity: null })).toBe("made")
    expect(productionStateOf({ status: "completed", produced_quantity: 1 })).toBe("made")
  })

  it("in-flight statuses mean BEING MADE", () => {
    expect(productionStateOf({ status: "in_progress" })).toBe("being_made")
    expect(productionStateOf({ status: "sent_to_partner" })).toBe("being_made")
  })

  it("pre-production statuses mean QUEUED, not made", () => {
    for (const s of ["draft", "pending_review", "approved", "awaiting_reassignment"]) {
      expect(productionStateOf({ status: s })).toBe("queued")
    }
  })

  it("🔴 cancelled is NOT production — a run existing is not enough", () => {
    // The naive rule "a run exists, therefore reassure" would tell a customer
    // whose run was cancelled that their garment is in hand.
    expect(productionStateOf({ status: "cancelled" })).toBe("not_started")
    expect(isReassuring(productionStateOf({ status: "cancelled" }))).toBe(false)
  })

  it("no run, and an unrecognised status, promise the least", () => {
    expect(productionStateOf(null)).toBe("not_started")
    expect(productionStateOf({ status: null })).toBe("not_started")
    expect(productionStateOf({ status: "some_new_status" })).toBe("not_started")
  })

  /**
   * 🔴 The distinction that reached a customer. Order #3's items carry a null
   * `variant_id` (#1918) so no run was ever stamped with their line ids, while
   * each of their designs had TWO completed runs — and the email told Aline her
   * finished garments had "not started yet".
   */
  it("says UNKNOWN, not 'not started', when the line has no run but the design does", () => {
    expect(productionStateOf(null, { designHasRuns: true })).toBe("unknown")
    expect(productionStateOf(null, { designHasRuns: false })).toBe("not_started")
    expect(productionStateOf(null)).toBe("not_started")

    // It only ever downgrades an absence. A run ON THE LINE still answers, and
    // still wins — a design-level run must never upgrade a claim.
    expect(
      productionStateOf({ status: "completed" }, { designHasRuns: true })
    ).toBe("made")
    expect(
      productionStateOf({ status: "cancelled" }, { designHasRuns: true })
    ).toBe("not_started")

    // And it promises nothing: unknown is not reassuring.
    expect(isReassuring("unknown")).toBe(false)
    expect(PRODUCTION_STATE_LABELS.unknown).not.toMatch(/not started|already made/i)
  })
})

describe("readProducedQuantity", () => {
  it("keeps a real 0 but returns null for absence", () => {
    expect(readProducedQuantity(0)).toBe(0)
    expect(readProducedQuantity(null)).toBeNull()
    expect(readProducedQuantity(undefined)).toBeNull()
    expect(readProducedQuantity("")).toBeNull()
    expect(readProducedQuantity("1")).toBe(1)
  })
})

describe("actionOf", () => {
  it("names each change from the pair, not from a null", () => {
    expect(actionOf(change({ previous_design: null }))).toBe("attached")
    expect(actionOf(change({ new_design: null }))).toBe("detached")
    expect(actionOf(change({}))).toBe("replaced")
    expect(
      actionOf(change({ previous_design: { id: "d", name: "D" }, new_design: { id: "d", name: "D" } }))
    ).toBe("unchanged")
  })

  it("a detach from nothing is unchanged, not a detach", () => {
    expect(actionOf(change({ previous_design: null, new_design: null }))).toBe("unchanged")
  })
})

describe("buildDesignChangeNotice — Aline's order", () => {
  /** The skirt: completed run, already delivered. */
  const skirt = change({
    line_item_id: "ordli_01KNP520PX9QTNFNKWPY3W0XFS",
    item_title: "Flowy Skirt",
    run: { id: "prod_run_01KY32DWYVDWC5NE9JTM533JV3", status: "completed", produced_quantity: 1 },
  })
  /** The jacket: no run at all. Three of her items look like this. */
  const jacket = change({
    line_item_id: "ordli_01KNP520PWJAES0MWCD6HCW4XC",
    item_title: "Floral Prints Open Jacket",
    run: null,
  })

  it("🔴 does NOT claim everything is in hand when one item has no run", () => {
    const notice = buildDesignChangeNotice([skirt, jacket])
    expect(notice.all_in_hand).toBe(false)
    expect(notice.any_not_started).toBe(true)
    // The headline must not carry the reassuring wording.
    expect(notice.headline).not.toMatch(/already in hand|nothing is delayed/i)
  })

  it("reassures only when EVERY changed garment is in hand", () => {
    const notice = buildDesignChangeNotice([skirt])
    expect(notice.all_in_hand).toBe(true)
    expect(notice.headline).toMatch(/already in hand/i)
  })

  it("reports each garment's state per line, not as a blanket", () => {
    const notice = buildDesignChangeNotice([skirt, jacket])
    const byItem = Object.fromEntries(notice.lines.map((l) => [l.item_title, l]))
    expect(byItem["Flowy Skirt"].production_state).toBe("made")
    expect(byItem["Flowy Skirt"].reassuring).toBe(true)
    expect(byItem["Floral Prints Open Jacket"].production_state).toBe("not_started")
    expect(byItem["Floral Prints Open Jacket"].reassuring).toBe(false)
  })

  it("all four of her unstarted items stay unreassured together", () => {
    const four = ["Floral Prints Open Jacket", "Simple blue striped white dress", "Jolly jungle", "Dark Desires Dress"]
      .map((t) => change({ item_title: t, run: null }))
    const notice = buildDesignChangeNotice(four)
    expect(notice.changed_lines).toHaveLength(4)
    expect(notice.changed_lines.every((l) => !l.reassuring)).toBe(true)
    expect(notice.all_in_hand).toBe(false)
  })

  it("does not send when nothing actually changed", () => {
    const same = change({
      previous_design: { id: "d", name: "D" },
      new_design: { id: "d", name: "D" },
    })
    const notice = buildDesignChangeNotice([same])
    expect(notice.should_send).toBe(false)
    expect(notice.changed_lines).toHaveLength(0)
    // An unchanged-only notice must not claim everything is in hand either.
    expect(notice.all_in_hand).toBe(false)
  })

  it("does not send for an empty change set", () => {
    expect(buildDesignChangeNotice([]).should_send).toBe(false)
    expect(buildDesignChangeNotice([]).all_in_hand).toBe(false)
  })

  it("omits a produced quantity that was never recorded", () => {
    const notice = buildDesignChangeNotice([
      change({ run: { status: "completed", produced_quantity: null } }),
    ])
    expect(notice.changed_lines[0].production_state).toBe("made")
    expect(notice.changed_lines[0].produced_quantity).toBeNull()
  })
})

describe("nextItemMetadata", () => {
  const original = { cost_type: "total", design_id: "d_first", other: 1 }

  it("moves design_id to the new design", () => {
    expect(nextItemMetadata(original, "d_second").design_id).toBe("d_second")
  })

  it("🔴 detach writes null — a key cannot be REMOVED through this API", () => {
    const out = nextItemMetadata(original, null)
    expect(out.design_id).toBeNull()
    // The key stays present; both readers guard on typeof === "string", so a
    // null correctly stops resolving.
    expect(Object.prototype.hasOwnProperty.call(out, "design_id")).toBe(true)
  })

  it("🔴 preserves the FIRST design across repeated re-points", () => {
    const once = nextItemMetadata(original, "d_second")
    const twice = nextItemMetadata(once, "d_third")
    const thrice = nextItemMetadata(twice, null)
    // "What did the customer order?" has one answer however often it moves.
    expect(once.original_design_id).toBe("d_first")
    expect(twice.original_design_id).toBe("d_first")
    expect(thrice.original_design_id).toBe("d_first")
  })

  it("does not invent provenance for an item that never had a design", () => {
    const out = nextItemMetadata({ cost_type: "total" }, "d_new")
    expect(out.original_design_id).toBeUndefined()
    expect(out.design_id).toBe("d_new")
  })

  it("leaves every unrelated key untouched and does not mutate the input", () => {
    const input = { ...original }
    const out = nextItemMetadata(input, "d_second")
    expect(out.cost_type).toBe("total")
    expect(out.other).toBe(1)
    expect(input.design_id).toBe("d_first")
  })

  it("tolerates a null/undefined metadata blob", () => {
    expect(nextItemMetadata(null, "d").design_id).toBe("d")
    expect(nextItemMetadata(undefined, null).design_id).toBeNull()
  })
})
