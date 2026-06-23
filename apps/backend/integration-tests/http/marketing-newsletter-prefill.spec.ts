import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { MARKETING_MODULE } from "../../src/modules/marketing"

jest.setTimeout(60 * 1000)

/**
 * #659 — GET /admin/marketing/newsletter-prefill
 *
 * The wiring that lets the blog editor pre-fill a `page_type="Newsletter"` page
 * from the latest AI newsletter draft (the #687 generate-newsletter-draft job
 * persists these as `marketing_draft` rows, kind="newsletter"). Proves the
 * end-to-end chain: a seeded draft payload → the endpoint's mapped title/content.
 *
 * Shared HTTP test DB TRUNCATEs between it()s, so each test seeds its own draft.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  it("returns draft:null + empty fields when no newsletter draft exists", async () => {
    const res = await api.get("/admin/marketing/newsletter-prefill", headers)
    expect(res.status).toBe(200)
    expect(res.data.draft).toBeNull()
    expect(res.data.title).toBe("")
    expect(res.data.content).toBe("")
  })

  it("maps the latest newsletter draft payload to editor title + content", async () => {
    const svc: any = getContainer().resolve(MARKETING_MODULE)
    await svc.createMarketingDrafts([
      {
        name: "weekly-2026-06-23",
        kind: "newsletter",
        payload: {
          subject: "Weekly JYT — New Fabrics In",
          preheader: "Fresh drops + a flash sale",
          intro: "Hello! Here's what's new this week.",
          sections: [
            { heading: "New Arrivals", body: "Handloom cottons just landed." },
            { heading: "Flash Sale", body: "20% off through Sunday." },
          ],
        },
      },
    ])

    const res = await api.get("/admin/marketing/newsletter-prefill", headers)
    expect(res.status).toBe(200)
    expect(res.data.draft).not.toBeNull()
    expect(res.data.draft.name).toBe("weekly-2026-06-23")
    expect(res.data.title).toBe("Weekly JYT — New Fabrics In")
    // content = intro, then "## heading / body" per section, blank-line joined.
    expect(res.data.content).toBe(
      "Hello! Here's what's new this week.\n\n" +
        "## New Arrivals\n\nHandloom cottons just landed.\n\n" +
        "## Flash Sale\n\n20% off through Sunday."
    )
  })
})
