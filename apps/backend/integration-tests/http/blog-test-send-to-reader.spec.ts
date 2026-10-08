import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(90000)

/**
 * The blog test send, used by hand to catch up a real reader who missed a
 * broadcast (2026-10-08: two people added in the admin were never
 * subscribed). With `person_id` the email greets them by name and carries
 * their own unsubscribe link; the guards keep it from going to the wrong
 * address or to someone who asked us to stop.
 */
setupSharedTestSuite(() => {
  let headers: any
  let websiteId: string
  let pageId: string
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
    const site = await api.post(
      "/admin/websites",
      { name: "Catch-up site", domain: `catchup-${Date.now()}.test`, status: "Active" },
      headers
    )
    websiteId = site.data.website.id
    const page = await api.post(
      `/admin/websites/${websiteId}/pages`,
      {
        title: "Meet Luna",
        slug: `meet-luna-${Date.now()}`,
        content: JSON.stringify({ text: { type: "doc", content: [] }, type: "blog" }),
        status: "Published",
        page_type: "Blog",
      },
      headers
    )
    pageId = page.data.page.id
  })

  const createPerson = async (extra: Record<string, any> = {}) =>
    (getContainer().resolve("person") as any).createPeople({
      first_name: "Cici",
      last_name: "Rotell",
      email: `cici-${Date.now()}@example.test`,
      ...extra,
    })

  const send = (body: Record<string, any>) =>
    api
      .post(`/admin/websites/${websiteId}/pages/${pageId}/subs/test`, body, headers)
      .catch((e) => e.response)

  it("sends to the reader when the email is theirs", async () => {
    const person = await createPerson()
    const res = await send({ email: person.email, person_id: person.id, subject: "Saransh from JYT: Meet Luna" })
    expect(res.status).toBe(200)
    expect(res.data.email).toBe(person.email)
  })

  it("refuses an email that is not the person's", async () => {
    const person = await createPerson()
    const res = await send({ email: "someone-else@example.test", person_id: person.id })
    expect(res.status).toBe(400)
  })

  it("refuses a person who unsubscribed", async () => {
    const person = await createPerson({ metadata: { unsubscribed: true } })
    const res = await send({ email: person.email, person_id: person.id })
    expect(res.status).toBe(400)
  })

  it("404s an unknown person", async () => {
    const res = await send({ email: "x@example.test", person_id: "missing_person" })
    expect(res.status).toBe(404)
  })

  it("a plain preview (no person) still works", async () => {
    const res = await send({ email: "me@example.test" })
    expect(res.status).toBe(200)
  })
})
