/**
 * #1274 — the `designs` summary that feeds the Design Orders table's picture
 * column in partner-ui shipped without integration coverage. This asserts the
 * whole path the partner actually sees: a design with media → dispatched to a
 * partner → `GET /partners/orders?kind=design` carries the design's name AND a
 * usable thumbnail on the row.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

const TEST_PARTNER_PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("GET /partners/orders → design summary (#1274)", () => {
    let adminHeaders: any
    let partnerHeaders: any
    let partnerId: string
    let unique: number

    const post = async (path: string, body?: any, headers?: any) =>
      await api.post(path, body, headers)

    beforeAll(async () => {
      unique = Date.now()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      const email = `design-summary-partner-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const login1 = await post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers1 = {
        headers: { Authorization: `Bearer ${login1.data.token}` },
      }

      const partnerRes = await post(
        "/partners",
        {
          name: `Design Summary Partner ${unique}`,
          handle: `design-summary-${unique}`,
          admin: { email, first_name: "Design", last_name: "Summary" },
        },
        headers1
      )
      partnerId = partnerRes.data.partner.id

      const login2 = await post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = {
        headers: { Authorization: `Bearer ${login2.data.token}` },
      }

      const currenciesRes = await api.get("/admin/currencies", adminHeaders)
      const currencies = currenciesRes.data.currencies || []
      const inr = currencies.find((c: any) => c.code?.toLowerCase() === "inr")
      const cc = String((inr || currencies[0]).code).toLowerCase()

      await post(
        "/partners/stores",
        {
          store: {
            name: `Design Summary Store ${unique}`,
            supported_currencies: [{ currency_code: cc, is_default: true }],
          },
          sales_channel: { name: `Design Summary Channel ${unique}` },
          region: { name: "Design Summary Region", currency_code: cc, countries: ["in"] },
          location: {
            name: "Design Summary Warehouse",
            address: {
              address_1: "1 Mill Road",
              city: "Jaipur",
              postal_code: "302001",
              country_code: "IN",
            },
          },
        },
        partnerHeaders
      )
    })

    it("carries the design's name and thumbnail on the work-order row", async () => {
      const thumbnailUrl = `https://cdn.jyt.test/design-summary-${unique}.png`

      const designRes = await post(
        "/admin/designs",
        {
          name: `Design Summary ${unique}`,
          description: "Design whose picture the partner table shows",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      // The picture the row must show — a flagged media file is the highest
      // preference `resolveDesignThumbnail` has.
      const mediaRes = await api.put(
        `/admin/designs/${designId}`,
        {
          media_files: [
            { id: `media-${unique}`, url: thumbnailUrl, isThumbnail: true },
          ],
        },
        adminHeaders
      )
      expect([200, 201]).toContain(mediaRes.status)

      const templateName = `design-summary-step-${unique}`
      const tpl = await post(
        "/admin/task-templates",
        {
          name: templateName,
          description: `${templateName} template`,
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Design Summary Test",
        },
        adminHeaders
      )
      expect([200, 201]).toContain(tpl.status)
      const templateId = tpl.data.task_template.id

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            {
              partner_id: partnerId,
              quantity: 4,
              role: "manufacturing",
              template_ids: [templateId],
            },
          ],
        },
        adminHeaders
      )
      expect([200, 201]).toContain(createRes.status)
      expect(createRes.data.children?.[0]?.id).toBeTruthy()

      const listRes = await api.get(
        "/partners/orders?kind=design&limit=100",
        partnerHeaders
      )
      expect(listRes.status).toBe(200)

      const rows = listRes.data.orders || []
      const row = rows.find((o: any) =>
        (o?.designs || []).some((d: any) => String(d.id) === String(designId))
      )

      // Before failing on the thumbnail, say whether the summary arrived at
      // all — "no designs key" and "designs without a picture" are different
      // bugs with different fixes.
      expect({
        found: Boolean(row),
        anyDesigns: rows.some((o: any) => (o?.designs || []).length > 0),
        sample: rows[0]
          ? { id: rows[0].id, designs: rows[0].designs ?? null }
          : null,
      }).toEqual(
        expect.objectContaining({ found: true })
      )

      const summary = (row.designs || []).find(
        (d: any) => String(d.id) === String(designId)
      )
      expect(summary.name).toBe(`Design Summary ${unique}`)
      expect(summary.thumbnail).toBe(thumbnailUrl)

      // The table never requests the bare list — it sends the configurable
      // column set as `fields`. A summary attached after the page is built
      // must survive that selection, or the picture column is empty in the
      // one call the UI actually makes.
      const withFields = await api.get(
        `/partners/orders?kind=design&limit=100&fields=${encodeURIComponent(
          "id,display_id,created_at,status,unified_order_status.partner_status"
        )}`,
        partnerHeaders
      )
      expect(withFields.status).toBe(200)

      const fieldRow = (withFields.data.orders || []).find(
        (o: any) => String(o.id) === String(row.id)
      )
      expect(fieldRow).toBeDefined()
      expect(
        (fieldRow.designs || []).find(
          (d: any) => String(d.id) === String(designId)
        )?.thumbnail
      ).toBe(thumbnailUrl)
    })

    /**
     * Why a real design can still show the placeholder: a design whose only
     * picture lives in the moodboard as an inlined `data:` URL resolves to no
     * thumbnail on a LIST, by design — base64 images would be megabytes of
     * JSON per row. Uploaded (rather than generated) moodboard images are
     * exactly that shape, so those rows are pictureless even though the
     * design plainly has an image on its detail page.
     */
    it("has no list thumbnail when the only image is an inlined moodboard data URL", async () => {
      const designRes = await post(
        "/admin/designs",
        {
          name: `Design Summary Inlined ${unique}`,
          description: "Only picture is a base64 moodboard image",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
          moodboard: {
            elements: [{ type: "image", fileId: "f1", isDeleted: false }],
            files: {
              f1: {
                dataURL:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              },
            },
          },
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      const templateName = `design-summary-inlined-${unique}`
      const tpl = await post(
        "/admin/task-templates",
        {
          name: templateName,
          description: `${templateName} template`,
          priority: "medium",
          estimated_duration: 60,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run" },
          category: "Design Summary Test",
        },
        adminHeaders
      )
      expect([200, 201]).toContain(tpl.status)

      const createRes = await post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [
            {
              partner_id: partnerId,
              quantity: 2,
              role: "manufacturing",
              template_ids: [tpl.data.task_template.id],
            },
          ],
        },
        adminHeaders
      )
      expect([200, 201]).toContain(createRes.status)

      const listRes = await api.get(
        "/partners/orders?kind=design&limit=100",
        partnerHeaders
      )
      const row = (listRes.data.orders || []).find((o: any) =>
        (o?.designs || []).some((d: any) => String(d.id) === String(designId))
      )
      expect(row).toBeDefined()

      const summary = (row.designs || []).find(
        (d: any) => String(d.id) === String(designId)
      )
      // The row still names the design — it just has no picture to show.
      expect(summary.name).toBe(`Design Summary Inlined ${unique}`)
      expect(summary.thumbnail).toBeNull()
    })
  })
})
