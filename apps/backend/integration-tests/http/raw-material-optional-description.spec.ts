import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

/**
 * #1737 — `description` was `.optional()` in the route validator and NOT NULL
 * on the model, the only description in the module that was.
 *
 * 🔴 The mismatch did not surface as a 400 naming the field. It reached
 * MikroORM as a required-property violation and came back as an unhandled
 * **500 with an HTML body** — `Internal Server Error`, nothing else. On
 * production that cost a CloudWatch dig to find
 * `ValidationError: Value for RawMaterials.description is required`; a caller
 * sees a server error and reasonably concludes the fault is theirs.
 *
 * ⚠️ `split-inventory-item` walks the same path: it passes
 * `rest.description ?? src?.description`, undefined whenever neither side has
 * one. The AI extraction path escaped only by hardcoding "Created from image
 * extraction" — a description invented to satisfy a constraint is not a
 * description, which is the argument for the column being nullable rather than
 * the validator being stricter.
 */
setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  const newInventoryItem = async (tag: string) => {
    const res = await api.post(
      "/admin/inventory-items",
      { title: `Desc Test Item ${tag}` },
      headers
    )
    expect(res.status).toBe(200)
    return res.data.inventory_item.id as string
  }

  it("creates a raw material with no description at all", async () => {
    const itemId = await newInventoryItem("omitted")

    const res = await api
      .post(
        `/admin/inventory-items/${itemId}/rawmaterials`,
        {
          rawMaterialData: {
            name: "White Terry Towel",
            composition: "Cotton",
            unit_of_measure: "Piece",
            status: "Active",
          },
        },
        headers
      )
      .catch((e: any) => e.response)

    /**
     * Before the model was made nullable this was a 500 with an HTML body.
     * Asserting `not.toBe(500)` as well as the success code, because the
     * failure mode being fixed is specifically "unhandled", not "rejected".
     */
    expect(res.status).not.toBe(500)
    expect(res.status).toBe(201)
  })

  it("still accepts a description when one is given", async () => {
    const itemId = await newInventoryItem("given")

    const res = await api
      .post(
        `/admin/inventory-items/${itemId}/rawmaterials`,
        {
          rawMaterialData: {
            name: "Kala Cotton",
            description: "Handspun, undyed",
            composition: "Cotton",
            unit_of_measure: "Meter",
            status: "Active",
          },
        },
        headers
      )
      .catch((e: any) => e.response)

    expect(res.status).toBe(201)
  })
})
