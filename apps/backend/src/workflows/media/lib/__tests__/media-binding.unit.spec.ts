import {
  normalizeMediaFiles,
  appendMediaFile,
  removeMediaFile,
  isMediaBound,
  stampBinding,
  clearBinding,
  readBinding,
} from "../media-binding"

describe("media-binding pure helpers", () => {
  describe("normalizeMediaFiles", () => {
    it("returns [] for null/undefined/garbage", () => {
      expect(normalizeMediaFiles(null)).toEqual([])
      expect(normalizeMediaFiles(undefined)).toEqual([])
      expect(normalizeMediaFiles(42 as any)).toEqual([])
      expect(normalizeMediaFiles({} as any)).toEqual([])
    })

    it("reads the canonical { files: string[] } shape", () => {
      expect(normalizeMediaFiles({ files: ["a", "b"] })).toEqual(["a", "b"])
    })

    it("reads a bare string[]", () => {
      expect(normalizeMediaFiles(["a", "b"])).toEqual(["a", "b"])
    })

    it("reads object entries via url/file_path", () => {
      expect(
        normalizeMediaFiles({ files: [{ url: "a" }, { file_path: "b" }] })
      ).toEqual(["a", "b"])
    })

    it("de-dupes and drops blanks", () => {
      expect(
        normalizeMediaFiles({ files: ["a", "a", "", "  ", "b"] })
      ).toEqual(["a", "b"])
    })
  })

  describe("appendMediaFile (idempotent bind)", () => {
    it("appends a new url in canonical shape", () => {
      expect(appendMediaFile({ files: ["a"] }, "b")).toEqual({ files: ["a", "b"] })
    })

    it("is idempotent — re-binding the same url does not duplicate", () => {
      expect(appendMediaFile({ files: ["a", "b"] }, "b")).toEqual({
        files: ["a", "b"],
      })
    })

    it("seeds from null media", () => {
      expect(appendMediaFile(null, "a")).toEqual({ files: ["a"] })
    })

    it("trims and ignores empty urls", () => {
      expect(appendMediaFile({ files: ["a"] }, "  ")).toEqual({ files: ["a"] })
      expect(appendMediaFile({ files: ["a"] }, " b ")).toEqual({
        files: ["a", "b"],
      })
    })
  })

  describe("removeMediaFile (unbind)", () => {
    it("removes the url and keeps the rest", () => {
      expect(removeMediaFile({ files: ["a", "b"] }, "a")).toEqual({
        files: ["b"],
      })
    })

    it("is a no-op when the url is absent", () => {
      expect(removeMediaFile({ files: ["a"] }, "z")).toEqual({ files: ["a"] })
    })

    it("handles null media", () => {
      expect(removeMediaFile(null, "a")).toEqual({ files: [] })
    })
  })

  describe("isMediaBound", () => {
    it("detects presence", () => {
      expect(isMediaBound({ files: ["a", "b"] }, "b")).toBe(true)
      expect(isMediaBound({ files: ["a"] }, "b")).toBe(false)
    })
  })

  describe("metadata back-reference stamp/clear/read", () => {
    it("stamps a binding while preserving existing metadata", () => {
      const out = stampBinding(
        { foo: "bar" },
        { bound_raw_material_id: "rm_1", bound_raw_material_name: "Cotton", bound_sku: "SKU-1" }
      )
      expect(out).toEqual({
        foo: "bar",
        bound_raw_material_id: "rm_1",
        bound_raw_material_name: "Cotton",
        bound_sku: "SKU-1",
      })
    })

    it("defaults name/sku to null", () => {
      const out = stampBinding(null, { bound_raw_material_id: "rm_1" })
      expect(out).toEqual({
        bound_raw_material_id: "rm_1",
        bound_raw_material_name: null,
        bound_sku: null,
      })
    })

    it("nulls the binding keys (merge-safe) and preserves other metadata", () => {
      const out = clearBinding({
        foo: "bar",
        bound_raw_material_id: "rm_1",
        bound_raw_material_name: "Cotton",
        bound_sku: "SKU-1",
      })
      expect(out).toEqual({
        foo: "bar",
        bound_raw_material_id: null,
        bound_raw_material_name: null,
        bound_sku: null,
      })
      // readBinding treats the nulled binding as "not bound"
      expect(readBinding(out)).toBeNull()
    })

    it("reads back a stamped binding (round-trip)", () => {
      const stamped = stampBinding(null, {
        bound_raw_material_id: "rm_9",
        bound_raw_material_name: "Silk",
        bound_sku: "SKU-9",
      })
      expect(readBinding(stamped)).toEqual({
        raw_material_id: "rm_9",
        raw_material_name: "Silk",
        sku: "SKU-9",
      })
    })

    it("returns null when no binding present", () => {
      expect(readBinding(null)).toBeNull()
      expect(readBinding({ foo: "bar" })).toBeNull()
    })
  })
})
