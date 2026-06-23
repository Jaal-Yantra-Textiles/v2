import { pageSchema, createPagesSchema, updatePageSchema } from "../validators"

const validBase = {
  title: "Spring Newsletter",
  slug: "spring-newsletter",
  content: "<p>Hello subscribers</p>",
}

describe("page validators — Newsletter page_type", () => {
  describe("pageSchema", () => {
    it("accepts page_type = 'Newsletter'", () => {
      const parsed = pageSchema.parse({ ...validBase, page_type: "Newsletter" })
      expect(parsed.page_type).toBe("Newsletter")
    })

    it("still accepts the existing 'Blog' page_type", () => {
      const parsed = pageSchema.parse({ ...validBase, page_type: "Blog" })
      expect(parsed.page_type).toBe("Blog")
    })

    it("rejects a garbage page_type", () => {
      expect(() =>
        pageSchema.parse({ ...validBase, page_type: "NotARealType" })
      ).toThrow()
    })

    it("treats page_type as optional (don't-touch on partial intents)", () => {
      const parsed = pageSchema.parse({ ...validBase })
      expect(parsed.page_type).toBeUndefined()
    })
  })

  describe("createPagesSchema", () => {
    it("accepts a Newsletter page in the pages array", () => {
      const parsed = createPagesSchema.parse({
        pages: [{ ...validBase, page_type: "Newsletter" }],
      })
      expect(parsed.pages[0].page_type).toBe("Newsletter")
    })
  })

  describe("updatePageSchema", () => {
    it("accepts switching a page to Newsletter", () => {
      const parsed = updatePageSchema.parse({ page_type: "Newsletter" })
      expect(parsed.page_type).toBe("Newsletter")
    })

    it("rejects an invalid page_type on update", () => {
      expect(() => updatePageSchema.parse({ page_type: "Bogus" })).toThrow()
    })
  })
})
