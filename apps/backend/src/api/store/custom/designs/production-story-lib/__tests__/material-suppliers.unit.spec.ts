import { buildProductionStory } from "../build-story"
import { pickMaterialSuppliers } from "../material-suppliers"

const order = (id: string, partner: string | null, date: string, status = "Delivered") => ({
  id,
  status,
  order_date: `2026-${date}T00:00:00.000Z`,
  partner: partner ? { id: `p_${partner}`, name: partner } : null,
})

describe("pickMaterialSuppliers (#2442)", () => {
  it("names the partner on the most recent order for each fabric", () => {
    const suppliers = pickMaterialSuppliers({
      ordersByMaterial: { rm_cotton: ["io_old", "io_new"], rm_silk: ["io_silk"] },
      orders: [
        order("io_old", "Old Mill", "03-01"),
        order("io_new", "HR Handloom", "09-01"),
        order("io_silk", "Bhagalpur Weavers", "05-01"),
      ],
      designOrderIds: [],
    })
    expect(suppliers).toEqual({
      rm_cotton: { id: "p_HR Handloom", name: "HR Handloom" },
      rm_silk: { id: "p_Bhagalpur Weavers", name: "Bhagalpur Weavers" },
    })
  })

  it("prefers an order attached to this design over a newer one", () => {
    const suppliers = pickMaterialSuppliers({
      ordersByMaterial: { rm_cotton: ["io_for_design", "io_newer"] },
      orders: [order("io_for_design", "HR Handloom", "02-01"), order("io_newer", "Other Mill", "10-01")],
      designOrderIds: ["io_for_design"],
    })
    expect(suppliers.rm_cotton.name).toBe("HR Handloom")
  })

  it("never counts a cancelled order or one with no partner", () => {
    const suppliers = pickMaterialSuppliers({
      ordersByMaterial: { rm_cotton: ["io_cancelled", "io_nobody"] },
      orders: [order("io_cancelled", "Wrong Mill", "10-01", "Cancelled"), order("io_nobody", null, "09-01")],
      designOrderIds: ["io_cancelled"],
    })
    expect(suppliers).toEqual({})
  })

  it("puts the supplier on the material and the stage on the partner", () => {
    const story = buildProductionStory({
      designId: "d1",
      runs: [],
      activitiesByRun: {},
      logs: [],
      personLinks: [],
      partners: [{ stage_role: "stitching", partner: { id: "p_sharlho", name: "Sharlho" } }],
      inventoryItems: [{ id: "inv_1", raw_materials: { id: "rm_cotton", name: "Kala Cotton" } }],
      suppliers: { rm_cotton: { id: "p_hr", name: "HR Handloom" } },
    })
    expect(story.materials[0].supplier).toEqual({ id: "p_hr", name: "HR Handloom" })
    expect(story.partners).toEqual([{ id: "p_sharlho", name: "Sharlho", stage_role: "stitching" }])
  })
})
