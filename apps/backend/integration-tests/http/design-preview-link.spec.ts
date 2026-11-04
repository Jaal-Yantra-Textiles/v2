/**
 * #2500 — read-only moodboard preview links for a bundle (a design work order)
 * or one design.
 *
 * Admin mints a link for a work order → the PUBLIC page lists every design on
 * it with its CORE board (read from `design_moodboard`, not the legacy column)
 * and quantity → it can be opened repeatedly (no accept, not single-use) →
 * revoke hides the designs at once. Also pins the designer-invite landing to
 * the core board, which read only `design.moodboard` and showed nothing.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { WORK_ORDER_MODULE } from "../../src/modules/work_orders"

jest.setTimeout(60 * 1000)

const SCENE = {
  elements: [
    { id: "rect-1", type: "rectangle", x: 0, y: 0, width: 100, height: 60, isDeleted: false },
  ],
  appState: {},
  files: {},
}

setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()
  const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  const makeDesign = async (name: string) => {
    const designService: any = getContainer().resolve(DESIGN_MODULE)
    const created = await designService.createDesigns({
      name: `${name} ${uniq()}`,
      description: "Hand-loomed",
      design_type: "Original",
      status: "Conceptual",
      priority: "Medium",
    })
    return created.id as string
  }

  const makeWorkOrder = async (lines: Array<{ design_id: string | null; quantity: number }>) => {
    const workOrders: any = getContainer().resolve(WORK_ORDER_MODULE)
    const wo = await workOrders.createWorkOrders({
      kind: "design",
      collation: "collated",
      currency_code: "eur",
    })
    for (const [i, line] of lines.entries()) {
      await workOrders.createWorkOrderItems({
        work_order_id: wo.id,
        title: `Line ${i + 1}`,
        quantity: line.quantity,
        unit_price: 0,
        design_id: line.design_id,
      })
    }
    return wo
  }

  beforeAll(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  it("shares a bundle's designs read-only, with each core board, until revoked", async () => {
    const withBoard = await makeDesign("Bag for Paris")
    const noBoard = await makeDesign("Cord set")
    // The core board lives in design_moodboard; design.moodboard stays empty.
    const saved = await api.post(`/admin/designs/${withBoard}/moodboards`, { scene: SCENE }, headers)
    expect(saved.status).toBe(200)

    const wo = await makeWorkOrder([
      { design_id: withBoard, quantity: 10 },
      { design_id: noBoard, quantity: 2 },
      { design_id: null, quantity: 1 }, // a line with no design is not shown
    ])

    const mint = await api.post(`/admin/design-preview-links`, { order_id: wo.id }, headers)
    expect(mint.status).toBe(201)
    expect(mint.data.design_count).toBe(2)
    expect(mint.data.preview_link.scope).toBe("order")
    expect(mint.data.preview_link.label).toBe(`Bundle #${wo.display_id}`)
    expect(mint.data.preview_link.usable).toBe(true)
    expect(mint.data.preview_link.token_hash).toBeUndefined()
    const token = mint.data.url.split("/design-preview/")[1]
    expect(token).toBeTruthy()

    // Public, no auth — and opening it twice works (not single-use).
    for (let i = 0; i < 2; i++) {
      const page = await api.get(`/partners/design-previews/${token}`)
      expect(page.status).toBe(200)
      expect(page.data.preview.usable).toBe(true)
      expect(page.data.designs.map((d: any) => d.id)).toEqual([withBoard, noBoard])
      expect(page.data.designs.map((d: any) => d.quantity)).toEqual([10, 2])
      expect(page.data.designs[0].moodboard?.elements?.[0]?.id).toBe("rect-1")
      expect(page.data.designs[1].moodboard).toBeNull()
    }

    const list = await api.get(`/admin/design-preview-links?order_id=${wo.id}`, headers)
    expect(list.data.preview_links.map((l: any) => l.id)).toEqual([mint.data.preview_link.id])

    const revoke = await api.delete(`/admin/design-preview-links/${mint.data.preview_link.id}`, headers)
    expect(revoke.status).toBe(200)
    expect(revoke.data.preview_link.usable).toBe(false)

    const after = await api.get(`/partners/design-previews/${token}`)
    expect(after.status).toBe(200)
    expect(after.data.preview.usable).toBe(false)
    expect(after.data.designs).toEqual([])
  })

  it("shares one design", async () => {
    const designId = await makeDesign("Solo")
    const mint = await api.post(`/admin/design-preview-links`, { design_id: designId }, headers)
    expect(mint.status).toBe(201)
    const token = mint.data.url.split("/design-preview/")[1]
    const page = await api.get(`/partners/design-previews/${token}`)
    expect(page.data.designs.map((d: any) => d.id)).toEqual([designId])
    expect(page.data.designs[0].quantity).toBeNull()
  })

  it("refuses a bundle with no designs, both ids at once, and an unknown token", async () => {
    const empty = await makeWorkOrder([{ design_id: null, quantity: 1 }])
    const noDesigns = await api
      .post(`/admin/design-preview-links`, { order_id: empty.id }, headers)
      .catch((e: any) => e.response)
    expect(noDesigns.status).toBe(400)

    const both = await api
      .post(`/admin/design-preview-links`, { order_id: empty.id, design_id: "x" }, headers)
      .catch((e: any) => e.response)
    expect(both.status).toBe(400)

    const unknown = await api
      .get(`/partners/design-previews/not-a-real-token`)
      .catch((e: any) => e.response)
    expect(unknown.status).toBe(404)
  })

  it("designer-invite landing shows the core board, not the empty legacy column", async () => {
    const designId = await makeDesign("Invite board")
    await api.post(`/admin/designs/${designId}/moodboards`, { scene: SCENE }, headers)
    const mint = await api.post(`/admin/designs/${designId}/designer-invites`, {}, headers)
    const info = await api.get(`/partners/designer-invites/${mint.data.token}`)
    expect(info.data.design.moodboard?.elements?.[0]?.id).toBe("rect-1")
  })
})
