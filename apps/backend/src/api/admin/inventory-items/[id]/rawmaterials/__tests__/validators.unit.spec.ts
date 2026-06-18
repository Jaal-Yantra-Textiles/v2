import {
  rawMaterialSchema,
  UpdateRawMaterialSchema,
} from "../validators"

describe("raw-material validators", () => {
  describe("UpdateRawMaterialSchema — unit_of_measure/status defaults must not survive .partial()", () => {
    it("does NOT inject unit_of_measure or status on a partial update", () => {
      // Regression: `.optional().default(...)` survives `.partial()` in Zod v4,
      // so omitting these used to inject "Other"/"Active" and clobber a
      // material's real unit/status (the route persists rawMaterialData to update).
      const parsed = UpdateRawMaterialSchema.parse({
        rawMaterialData: { unit_cost: 5 },
      })
      expect(parsed.rawMaterialData.unit_of_measure).toBeUndefined()
      expect(parsed.rawMaterialData.status).toBeUndefined()
      expect("unit_of_measure" in parsed.rawMaterialData).toBe(false)
      expect("status" in parsed.rawMaterialData).toBe(false)
      expect(parsed.rawMaterialData.unit_cost).toBe(5)
    })

    it("preserves explicitly provided unit_of_measure and status", () => {
      const parsed = UpdateRawMaterialSchema.parse({
        rawMaterialData: { unit_of_measure: "Meter", status: "Discontinued" },
      })
      expect(parsed.rawMaterialData.unit_of_measure).toBe("Meter")
      expect(parsed.rawMaterialData.status).toBe("Discontinued")
    })
  })

  describe("rawMaterialSchema — defaults stay intact on create", () => {
    it("still defaults unit_of_measure='Other' and status='Active' on create", () => {
      const parsed = rawMaterialSchema.parse({
        rawMaterialData: { name: "Cotton", composition: "100% cotton" },
      })
      expect(parsed.rawMaterialData.unit_of_measure).toBe("Other")
      expect(parsed.rawMaterialData.status).toBe("Active")
    })
  })
})
