import { actionsFromWords, isReferenceImage, orderLineToEvidence, productKind, productToEvidence, runPhotos } from "../read-partner-records"

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

  it("reads the kind from the line's material — a terry towel is a towel", () => {
    expect(orderLineToEvidence(order, { material_name: "White Terry Towel" }, { weaves: false })!.product_type).toBe("towel")
    expect(orderLineToEvidence(order, { material_name: "Kala Cotton" }, { weaves: false })!.product_type).toBe("fabric")
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

describe("productKind", () => {
  it.each([
    [{ title: "Pashmina Kani Shawl", type: { value: "jyt_tax_in_textile_over_2500" } }, "shawl"],
    [{ title: "Fish and bird cotton dari", type: { value: "India-25" } }, "dari"],
    [{ title: "Himalayan Ruby", type: { value: "2026" } }, null],
    [{ title: "Himalayan Ruby", type: { value: "Stole" } }, "stole"],
  ])("a tax class or a year is never the kind: %j → %s", (product, kind) => {
    expect(productKind(product)).toBe(kind)
  })
})

// #2249: an Oshen moodboard picture (clipped from another site by the CRM
// extension) was filed as proof that a robe was made.
describe("product evidence never carries a moodboard reference image", () => {
  const MOODBOARD =
    "https://automatic.jaalyantra.com/automatica/moodboard-design-for-oshen-1787541847116-1-01M0RWR026Y3WD6BPPZW9ZTG45.jpeg"
  const PHOTO = "https://automatic.jaalyantra.com/automatica/DSC05916-2-01KKV2BTZBH2PNHF32522J6Q1N.png"

  it("tells a moodboard clip from a photo", () => {
    expect(isReferenceImage(MOODBOARD)).toBe(true)
    expect(isReferenceImage(PHOTO)).toBe(false)
  })

  it("drops it from a listed product's images", () => {
    const e = productToEvidence({
      title: "Ahimsa Silk and Cotton Robe",
      status: "published",
      thumbnail: MOODBOARD,
      images: [{ url: MOODBOARD }, { url: PHOTO }],
    })
    expect(e.images).toEqual([PHOTO])
  })
})
