import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { RAW_MATERIAL_MODULE } from "../../src/modules/raw_material"

jest.setTimeout(60 * 1000)

/**
 * #817 S1 — the `raw_material_group` parent ("product") + nullable `group_id` on
 * `raw_materials` (the per-color "variant"). This slice ships no routes, so we
 * exercise the module service directly: boot the app (validates the model is
 * registered + its migration ran against the shared test DB), round-trip a group
 * with its enum defaults, then attach two per-color raw_materials and assert the
 * group ↔ raw_materials relation resolves both ways.
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("raw_material_group model", () => {
    it("resolves the service with group CRUD methods", () => {
      const svc: any = getContainer().resolve(RAW_MATERIAL_MODULE)
      expect(svc).toBeDefined()
      expect(typeof svc.createRawMaterialGroups).toBe("function")
      expect(typeof svc.listRawMaterialGroups).toBe("function")
    })

    it("round-trips a group and applies enum defaults (unit_of_measure=Other, status=Active)", async () => {
      const svc: any = getContainer().resolve(RAW_MATERIAL_MODULE)
      const created = await svc.createRawMaterialGroups({
        name: "Cotton Poplin",
        composition: "100% Cotton",
        specifications: { gsm: 120 },
      })

      expect(created.unit_of_measure).toBe("Other")
      expect(created.status).toBe("Active")

      const [rows, count] = await svc.listAndCountRawMaterialGroups({ id: created.id })
      expect(count).toBe(1)
      expect(rows[0].name).toBe("Cotton Poplin")
      expect(rows[0].composition).toBe("100% Cotton")
      expect(rows[0].specifications).toEqual({ gsm: 120 })
    })

    it("attaches per-color raw_materials to a group and resolves the relation both ways", async () => {
      const svc: any = getContainer().resolve(RAW_MATERIAL_MODULE)
      const group = await svc.createRawMaterialGroups({
        name: "Linen Blend",
        composition: "80% Linen 20% Cotton",
        unit_of_measure: "Meter",
      })

      const blue = await svc.createRawMaterials({
        name: "Linen Blend — Blue",
        description: "Blue colorway",
        composition: "80% Linen 20% Cotton",
        color: "Blue",
        group_id: group.id,
      })
      const red = await svc.createRawMaterials({
        name: "Linen Blend — Red",
        description: "Red colorway",
        composition: "80% Linen 20% Cotton",
        color: "Red",
        group_id: group.id,
      })

      // child -> parent
      const [child] = await svc.listRawMaterials(
        { id: blue.id },
        { relations: ["group"] }
      )
      expect(child.group?.id).toBe(group.id)
      expect(child.group?.name).toBe("Linen Blend")

      // parent -> children
      const [parent] = await svc.listRawMaterialGroups(
        { id: group.id },
        { relations: ["raw_materials"] }
      )
      const colors = parent.raw_materials.map((m: any) => m.color).sort()
      expect(parent.raw_materials).toHaveLength(2)
      expect(colors).toEqual(["Blue", "Red"])
      expect([blue.group_id, red.group_id]).toEqual([group.id, group.id])
    })

    it("leaves group_id null for ungrouped materials (backfill is a no-op)", async () => {
      const svc: any = getContainer().resolve(RAW_MATERIAL_MODULE)
      const orphan = await svc.createRawMaterials({
        name: "Standalone Wool",
        description: "not grouped",
        composition: "100% Wool",
      })
      expect(orphan.group_id ?? null).toBeNull()
    })
  })
})
