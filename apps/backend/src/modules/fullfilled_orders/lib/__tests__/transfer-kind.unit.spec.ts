import {
  classifyTransfer,
  transferKind,
  requiresRunApproval,
  validateMaterialTransfer,
  materialTransferItemId,
  assertReceivableMaterialTransfer,
} from "../transfer-kind"

/**
 * The two kinds of goods transfer (#2144).
 *
 * The case: 86 m of GOF cloth lands at Ksaman Naturals' bench. She keeps what
 * she will cut and the rest goes on to our warehouse. Nothing was produced, so
 * there is no run, no approval to wait for, and no variant to derive the item
 * from — every assumption `goods_transfer` was built on (#891) is absent, and
 * the movement is still real.
 */
describe("classifyTransfer", () => {
  it("a production run means run output", () => {
    expect(classifyTransfer({ production_run_id: "run_1" })).toEqual({
      ok: true,
      kind: "run_output",
    })
  })

  it("an inventory item means material", () => {
    expect(classifyTransfer({ inventory_item_id: "iitem_cloth" })).toEqual({
      ok: true,
      kind: "material",
    })
  })

  it("🔴 BOTH is a refusal — the two kinds disagree about the approval gate", () => {
    const c = classifyTransfer({
      id: "gtrf_1",
      production_run_id: "run_1",
      inventory_item_id: "iitem_cloth",
    })
    expect(c.ok).toBe(false)
    expect(!c.ok && c.reason).toBe("ambiguous")
    // Read one way it waits for approval; read the other it posts on a count.
    // Guessing would post unapproved output to our books.
    expect(!c.ok && c.message).toMatch(/cannot be both/)
  })

  it("🔴 NEITHER is a refusal — nothing says what moved", () => {
    const c = classifyTransfer({ id: "gtrf_2" })
    expect(c.ok).toBe(false)
    expect(!c.ok && c.reason).toBe("unspecified")
  })

  it("treats blank and whitespace ids as absent, not as present", () => {
    expect(classifyTransfer({ production_run_id: "  ", inventory_item_id: "iitem" })).toEqual({
      ok: true,
      kind: "material",
    })
    expect(classifyTransfer({ production_run_id: "", inventory_item_id: "" }).ok).toBe(false)
  })

  it("null and undefined rows classify as unspecified rather than throwing", () => {
    expect(classifyTransfer(null).ok).toBe(false)
    expect(transferKind(undefined)).toBeNull()
  })
})

describe("requiresRunApproval", () => {
  it("🔴 material NEVER waits for an approval — there is no run to approve", () => {
    // Getting this wrong holds a partner's cloth hostage to an approval that
    // cannot ever exist.
    expect(requiresRunApproval({ inventory_item_id: "iitem_cloth" })).toBe(false)
  })

  it("run output does wait for one", () => {
    expect(requiresRunApproval({ production_run_id: "run_1" })).toBe(true)
  })

  it("an unclassifiable row does not claim an approval gate", () => {
    expect(requiresRunApproval({})).toBe(false)
    expect(requiresRunApproval({ production_run_id: "r", inventory_item_id: "i" })).toBe(false)
  })
})

describe("validateMaterialTransfer", () => {
  const draft = (over: Record<string, any> = {}) => ({
    inventory_item_id: "iitem_cloth",
    from_location_id: "sloc_ksaman",
    to_location_id: "sloc_warehouse",
    quantity: 26,
    ...over,
  })

  it("accepts a real movement", () => {
    expect(validateMaterialTransfer(draft())).toEqual({ ok: true })
  })

  it("🔴 REFUSES a missing destination — material has no customer leg", () => {
    // On run output a null destination means "leaving for a customer" and the
    // move is deliberately skipped. Skipping here would leave the material
    // counted at the origin while somebody carries it away.
    const r = validateMaterialTransfer(draft({ to_location_id: null }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/no customer leg/)
  })

  it("refuses a move with no item, and one with no origin", () => {
    expect(validateMaterialTransfer(draft({ inventory_item_id: null })).ok).toBe(false)
    expect(validateMaterialTransfer(draft({ from_location_id: "" })).ok).toBe(false)
  })

  it("refuses a move to the same place", () => {
    const r = validateMaterialTransfer(draft({ to_location_id: "sloc_ksaman" }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/nothing would move/)
  })

  it("🔴 refuses zero and negative quantities", () => {
    expect(validateMaterialTransfer(draft({ quantity: 0 })).ok).toBe(false)
    expect(validateMaterialTransfer(draft({ quantity: -5 })).ok).toBe(false)
    expect(validateMaterialTransfer(draft({ quantity: null })).ok).toBe(false)
  })

  it("accepts decimal metres — cloth is not counted in whole units", () => {
    expect(validateMaterialTransfer(draft({ quantity: 26.5 })).ok).toBe(true)
  })
})

describe("materialTransferItemId", () => {
  it("names the item outright, because material has no run to derive it from", () => {
    expect(materialTransferItemId({ inventory_item_id: "iitem_cloth" })).toBe("iitem_cloth")
  })

  it("is null on run output, where the item comes from the run's variant", () => {
    expect(materialTransferItemId({ production_run_id: "run_1" })).toBeNull()
  })
})

describe("assertReceivableMaterialTransfer", () => {
  const material = (over: Record<string, any> = {}) => ({
    id: "gtrf_1",
    inventory_item_id: "iitem_cloth",
    status: "in_transit",
    ...over,
  })

  it("passes an in-transit material transfer", () => {
    expect(() => assertReceivableMaterialTransfer(material(), "gtrf_1")).not.toThrow()
  })

  it("🔴 refuses a SECOND receipt — receiving twice moves the same material twice", () => {
    expect(() =>
      assertReceivableMaterialTransfer(material({ status: "delivered" }), "gtrf_1")
    ).toThrow(/already been received/)
  })

  it("refuses a cancelled transfer", () => {
    expect(() =>
      assertReceivableMaterialTransfer(material({ status: "cancelled" }), "gtrf_1")
    ).toThrow(/never sent/)
  })

  it("refuses a missing transfer", () => {
    expect(() => assertReceivableMaterialTransfer(null, "gtrf_nope")).toThrow(/not found/)
  })

  it("🔴 refuses to receive RUN OUTPUT here — its approval gate lives on the run", () => {
    expect(() =>
      assertReceivableMaterialTransfer(
        { id: "gtrf_2", production_run_id: "run_1", status: "in_transit" },
        "gtrf_2"
      )
    ).toThrow(/receive it on the run/)
  })

  it("refuses an ambiguous row rather than picking a rule for it", () => {
    expect(() =>
      assertReceivableMaterialTransfer(
        { id: "gtrf_3", production_run_id: "run_1", inventory_item_id: "i", status: "in_transit" },
        "gtrf_3"
      )
    ).toThrow(/cannot be both/)
  })
})
