import { ExtractFolderFeaturesRequestSchema } from "../validators"
import { ExtractFeaturesRequestSchema } from "../../../../extract-features/validators"

/**
 * An extraction that does not save spends one AI call per photo and keeps
 * nothing the gallery can show ("sunny_new_photos", 2026-11-18: 26 analysed,
 * 0 rows). Saving is the default; a caller must opt OUT.
 */
describe("textile extraction saves results by default", () => {
  it("folder run: omitted persist means persist", () => {
    expect(ExtractFolderFeaturesRequestSchema.parse({}).persist).toBe(true)
  })

  it("folder run: an explicit false is still honoured", () => {
    expect(ExtractFolderFeaturesRequestSchema.parse({ persist: false }).persist).toBe(false)
  })

  it("single/batch run: omitted persist means persist", () => {
    const parsed: any = ExtractFeaturesRequestSchema.safeParse({
      media_id: "med_1",
      image_url: "https://example.com/a.jpg",
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data.persist).toBe(true)
  })
})
