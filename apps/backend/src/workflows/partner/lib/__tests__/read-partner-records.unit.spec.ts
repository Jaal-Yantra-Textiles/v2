import { actionsFromWords, orderLineToEvidence, runPhotos } from "../read-partner-records"

describe("actionsFromWords", () => {
  it.each([
    [["Stitching", "QC"], ["stitch"]],
    [["Pattern cutting"], ["stitch", "design"]],
    [["Embroidery and Painting"], ["embroider"]],
    [["Block Printing"], ["print"]],
    [["Natural indigo dyeing"], ["dye"]],
    [["Quality check", null, undefined], []],
  ])("%j → %j", (words, actions) => {
    expect(actionsFromWords(words as any).sort()).toEqual([...actions].sort())
  })
})

describe("orderLineToEvidence", () => {
  const order = { id: "inv_order_1", status: "Delivered", updated_at: "2026-08-02T00:00:00Z", order_date: "2026-07-01T00:00:00Z" }

  it("is cloth, dated by the delivered order's last update", () => {
    const e = orderLineToEvidence(order, { material_name: "Kala Cotton", color: "Rust", quantity: 10 }, { weaves: false })!
    expect(e.title).toBe("Kala Cotton — Rust")
    expect(e.published_at).toBe("2026-08-02T00:00:00.000Z")
    expect(e.hints).toEqual({ actions: [], material: "Kala Cotton" })
  })

  it("credits weave only when the partner said they weave", () => {
    expect(orderLineToEvidence(order, { material_name: "Linen" }, { weaves: true })!.hints!.actions).toEqual(["weave"])
  })

  it("skips a line with no material — it evidences nothing", () => {
    expect(orderLineToEvidence(order, { material_name: "  " }, { weaves: true })).toBeNull()
  })
})

describe("runPhotos", () => {
  it("keeps only the photos sent for THIS run", () => {
    const design = { media_files: [{ url: "a", run_id: "r1" }, { url: "b", run_id: "r2" }, { url: "c" }] }
    expect(runPhotos(design, "r1")).toEqual([{ id: null, url: "a" }])
  })
})
