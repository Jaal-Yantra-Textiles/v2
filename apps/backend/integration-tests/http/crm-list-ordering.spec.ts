/**
 * CRM list ordering (#1551).
 *
 *   GET /admin/crm/people?order=-created_at
 *
 * ## Why an integration test
 *
 * The wire format is unit-tested at both ends. What those tests cannot show is
 * that `order` survives the route and is honoured by a repository — and that a
 * value the allowlist rejects degrades to an UNSORTED list rather than an empty
 * one or a 400. That distinction is the whole point: the live CRM node reads
 * every param it does not recognise as an equality filter and answers
 * `count: 0` with a 200, so "orders by nothing" and "returns nothing" are the
 * two outcomes that must never be confused.
 *
 * ⚠️ This runs against the EMBEDDED Hyperbee store (see integration-tests/
 * setup.js), which is a FILE. The runner restores a Postgres snapshot before
 * every test and does not touch it, so CRM rows ACCUMULATE across the run.
 * Every case here asserts on contacts it created — identified by a unique
 * marker — and never on a total count.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  let adminHeaders: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    adminHeaders = await getAuthHeaders(api)
  })

  /** A contact whose surname is unique to this test, so it can be found again. */
  async function createPerson(marker: string, first: string) {
    const res = await api.post(
      "/admin/crm/people",
      { first_name: first, last_name: marker },
      adminHeaders
    )
    expect(res.status).toBe(201)
    return res.data.crm_person
  }

  const list = async (query: string) => {
    const res = await api.get(`/admin/crm/people?${query}`, adminHeaders)
    expect(res.status).toBe(200)
    return res.data.crm_people
  }

  const marker = () => `ord${Date.now()}${Math.floor(Math.random() * 1e6)}`

  it("🔴 the CRM module is up — every case below is meaningless otherwise", async () => {
    // A 500 here means the embedded DAL did not start, and the rest of this
    // file would fail with errors that look like route bugs. Fail on the cause.
    const res = await api
      .get("/admin/crm/people?limit=1", adminHeaders)
      .catch((e: any) => e.response)

    expect(res.status).toBe(200)
  })

  it("orders newest first", async () => {
    const m = marker()
    await createPerson(m, "First")
    await createPerson(m, "Second")
    await createPerson(m, "Third")

    const mine = (await list(`order=-created_at&limit=100&last_name=${m}`)).map(
      (p: any) => p.first_name
    )

    expect(mine).toEqual(["Third", "Second", "First"])
  })

  it("orders oldest first", async () => {
    const m = marker()
    await createPerson(m, "First")
    await createPerson(m, "Second")
    await createPerson(m, "Third")

    const mine = (await list(`order=created_at&limit=100&last_name=${m}`)).map(
      (p: any) => p.first_name
    )

    expect(mine).toEqual(["First", "Second", "Third"])
  })

  it("🔴 a disallowed column orders by NOTHING — it does not empty the list", async () => {
    // The failure this guards against returns a 200 with zero rows, which is
    // indistinguishable from "this partner has no contacts".
    const m = marker()
    await createPerson(m, "First")
    await createPerson(m, "Second")

    const rows = await list(`order=password&limit=100&last_name=${m}`)

    expect(rows).toHaveLength(2)
  })

  it("a malformed order value is ignored rather than rejected", async () => {
    // A list that ignores a bad sort beats a 400 on a page load.
    const m = marker()
    await createPerson(m, "Only")

    for (const bad of ["-", "", "-;drop table"]) {
      const rows = await list(
        `order=${encodeURIComponent(bad)}&limit=100&last_name=${m}`
      )
      expect(rows).toHaveLength(1)
    }
  })

  it("still filters while ordering — the two are not exclusive", async () => {
    const mine = marker()
    const theirs = marker()
    await createPerson(mine, "Kept")
    await createPerson(theirs, "Excluded")

    const rows = await list(`order=-created_at&limit=100&last_name=${mine}`)

    expect(rows).toHaveLength(1)
    expect(rows[0].first_name).toBe("Kept")
  })

  it("orders the other CRM collections too", async () => {
    // All six list routes learned the same param; companies is the check that
    // the change was not people-only.
    const m = marker()
    for (const name of [`${m}-alpha`, `${m}-beta`]) {
      const res = await api.post("/admin/crm/companies", { name }, adminHeaders)
      expect(res.status).toBe(201)
    }

    const res = await api.get(
      "/admin/crm/companies?order=-created_at&limit=100",
      adminHeaders
    )
    expect(res.status).toBe(200)

    const mine = res.data.crm_companies
      .filter((c: any) => String(c.name).startsWith(m))
      .map((c: any) => c.name)

    expect(mine).toEqual([`${m}-beta`, `${m}-alpha`])
  })
})
