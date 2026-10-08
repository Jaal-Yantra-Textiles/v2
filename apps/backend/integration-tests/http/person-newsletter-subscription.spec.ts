import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(90000)

/**
 * The newsletter switch on a person. The blog newsletter mails a person only
 * with an ACTIVE person_subs row, and only the website signup form made one —
 * so people added in the admin were silently never mailed (Cici Rotell, Mehak
 * Chauhan missed the 6 and 7 October 2026 sends).
 */
setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  const createPerson = async (extra: Record<string, any> = {}) => {
    const persons = getContainer().resolve("person") as any
    return persons.createPeople({
      first_name: "Cici",
      last_name: "Rotell",
      email: `cici-${Date.now()}@example.test`,
      ...extra,
    })
  }

  const subsOf = async (personId: string) => {
    const persons = getContainer().resolve("person") as any
    return persons.listPersonSubs({ person_id: personId })
  }

  it("a person added in the admin starts unsubscribed", async () => {
    const person = await createPerson()
    const res = await api.get(`/admin/persons/${person.id}/subscription`, headers)
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ subscribed: false, subscription: null, blocked_by: null })
  })

  it("subscribes, unsubscribes and re-subscribes on ONE row", async () => {
    const person = await createPerson()

    const on = await api.post(`/admin/persons/${person.id}/subscription`, { subscribed: true }, headers)
    expect(on.data.subscription).toMatchObject({
      subscription_status: "active",
      email_subscribed: person.email,
      subscription_type: "email",
      network: "jaalyantra",
    })

    // What the newsletter's recipient step reads.
    const persons = getContainer().resolve("person") as any
    const [withSub] = await persons.listPeople({ id: person.id }, { relations: ["subscribed"] })
    expect(withSub.subscribed?.subscription_status).toBe("active")

    const off = await api.post(`/admin/persons/${person.id}/subscription`, { subscribed: false }, headers)
    expect(off.data.subscription.subscription_status).toBe("inactive")

    const again = await api.post(`/admin/persons/${person.id}/subscription`, { subscribed: true }, headers)
    expect(again.data.subscription.subscription_status).toBe("active")
    expect(await subsOf(person.id)).toHaveLength(1)
  })

  it("refuses to re-subscribe someone who unsubscribed themselves", async () => {
    const person = await createPerson({ metadata: { unsubscribed: true } })
    const res = await api
      .post(`/admin/persons/${person.id}/subscription`, { subscribed: true }, headers)
      .catch((e) => e.response)
    expect(res.status).toBe(400)
    expect(await subsOf(person.id)).toHaveLength(0)
  })

  it("refuses a person with no email", async () => {
    const person = await createPerson({ email: null })
    const res = await api
      .post(`/admin/persons/${person.id}/subscription`, { subscribed: true }, headers)
      .catch((e) => e.response)
    expect(res.status).toBe(400)
  })

  it("404s an unknown person", async () => {
    const res = await api.get(`/admin/persons/missing_person/subscription`, headers).catch((e) => e.response)
    expect(res.status).toBe(404)
  })
})
