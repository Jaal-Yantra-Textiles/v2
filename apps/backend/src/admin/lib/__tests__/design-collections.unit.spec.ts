import {
  NO_COLLECTION_ID,
  collectionNameFromTag,
  collectionTag,
  groupDesignsByCollection,
} from "../design-collections"

describe("collectionNameFromTag", () => {
  it("reads the name after the collection: prefix", () => {
    expect(collectionNameFromTag("collection:Shramdaan Global Designs")).toBe("Shramdaan Global Designs")
    expect(collectionNameFromTag("Collection:  Winter 25 ")).toBe("Winter 25")
  })

  it("ignores feature tags, empty names and non-strings", () => {
    expect(collectionNameFromTag("French knot")).toBeNull()
    expect(collectionNameFromTag("collection:")).toBeNull()
    expect(collectionNameFromTag(42)).toBeNull()
  })

  it("round-trips with collectionTag", () => {
    expect(collectionNameFromTag(collectionTag(" Shramdaan Global Designs "))).toBe("Shramdaan Global Designs")
  })
})

describe("groupDesignsByCollection", () => {
  const d = (id: string, tags?: unknown) => ({ id, tags })

  it("groups by collection tag and ignores feature tags", () => {
    const groups = groupDesignsByCollection([
      d("bag", ["Embroidered on kala cotton", "collection:Shramdaan Global Designs"]),
      d("jacket", ["French knot", "collection:Shramdaan Global Designs"]),
      d("dress", ["French knot"]),
    ])
    expect(groups.map((g) => [g.name, g.designs.map((x) => x.id)])).toEqual([
      ["Shramdaan Global Designs", ["bag", "jacket"]],
      ["No collection", ["dress"]],
    ])
  })

  it("puts a design in every collection it names, sorted A-Z, ungrouped last", () => {
    const groups = groupDesignsByCollection([
      d("a", ["collection:Winter", "collection:Atelier"]),
      d("b", null),
    ])
    expect(groups.map((g) => g.name)).toEqual(["Atelier", "Winter", "No collection"])
    expect(groups[2].id).toBe(NO_COLLECTION_ID)
  })

  it("merges collections that differ only by case, keeping the first spelling", () => {
    const groups = groupDesignsByCollection([
      d("a", ["collection:Shramdaan Global Designs"]),
      d("b", ["collection:shramdaan global designs"]),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe("Shramdaan Global Designs")
    expect(groups[0].designs.map((x) => x.id)).toEqual(["a", "b"])
  })

  it("lists a design once per collection even if the tag repeats", () => {
    const groups = groupDesignsByCollection([d("a", ["collection:X", "collection:x"])])
    expect(groups[0].designs).toHaveLength(1)
  })

  it("omits the No collection group when every design has one", () => {
    expect(groupDesignsByCollection([d("a", ["collection:X"])]).map((g) => g.name)).toEqual(["X"])
  })
})
