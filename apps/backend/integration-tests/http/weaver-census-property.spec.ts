import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(120000)

/**
 * The weaver "edit / changes" routes, addressed by census_id (#1864).
 *
 * 🔴 These exist because #1864 shipped completely broken and nothing caught it.
 * It had five unit tests, all of them on `applyWeaverCorrections` — the one
 * layer that was correct. Nothing exercised a route, and the defect was in the
 * wiring: `listAndCount*` returns `[rows, count]`, and all three call sites read
 * the first element as if it were a record.
 *
 * On the POST that is not a mis-shaped response but a dead feature: `existing`
 * was the row LIST, an empty array is TRUTHY, so the create branch could never
 * run and the first save of every weaver answered
 *
 *   {"message":"PersonProperty with id \"\" not found"}   HTTP 404
 *
 * So the assertions below are deliberately about the SHAPE and the SEQUENCE
 * rather than about correction semantics: that the first POST creates, that a
 * second POST updates the same record rather than making another, and that GET
 * answers with an object or null and never with an array. Each one of those
 * fails on the code as merged.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  let auth: { headers: Record<string, string> }
  /** Unique per test: the routes upsert on this natural key. */
  let censusId: string

  /*
   * 🔴 Per TEST, not per file. The shared runner restores a database snapshot
   * before every test, so an admin user created in `beforeAll` no longer exists
   * by the time the second test runs and its perfectly well-formed bearer token
   * answers 401 on every admin route — including ones that have nothing to do
   * with this feature, which is how I established it was the user and not the
   * route.
   */
  beforeEach(async () => {
    await createAdminUser(getContainer())
    auth = await getAuthHeaders(api)
    censusId = `census-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  })

  const url = (id: string) => `/admin/person-properties/by-census/${id}`

  it("answers null — not an empty array — when no record exists", async () => {
    const res = await api.get(url(censusId), auth)

    expect(res.status).toEqual(200)
    /*
     * `toBeNull` alone would pass on `undefined`, and the bug produced `[]`,
     * which is neither. Assert the absence AND that nothing array-shaped got
     * through, because `[]` is exactly what a reader would treat as a record.
     */
    expect(res.data.person_property).toBeNull()
    expect(Array.isArray(res.data.person_property)).toBe(false)
  })

  it("CREATES on the first save, and returns the record itself", async () => {
    const res = await api.post(
      url(censusId),
      {
        social_media: [{ platform: "instagram", handle: "@weaver" }],
        corrections: [
          { field: "district", corrected_value: "Bhilwara", note: "verified by phone" },
        ],
      },
      auth
    )

    // 404 here is the merged behaviour: the create branch was unreachable.
    expect(res.status).toEqual(201)
    const prop = res.data.person_property
    expect(Array.isArray(prop)).toBe(false)
    expect(prop?.id).toBeTruthy()
    expect(prop?.census_id).toEqual(censusId)
    expect(prop?.social_media?.[0]?.platform).toEqual("instagram")
    expect(prop?.corrections?.[0]?.corrected_value).toEqual("Bhilwara")
  })

  it("reads the created record back as an object", async () => {
    await api.post(
      url(censusId),
      { custom_fields: { loom_type: "pit" } },
      auth
    )

    const res = await api.get(url(censusId), auth)

    expect(res.status).toEqual(200)
    expect(Array.isArray(res.data.person_property)).toBe(false)
    expect(res.data.person_property?.census_id).toEqual(censusId)
    expect(res.data.person_property?.custom_fields?.loom_type).toEqual("pit")
  })

  it("UPDATES the same record on a second save rather than creating another", async () => {
    const created = await api.post(
      url(censusId),
      { custom_fields: { loom_type: "pit" } },
      auth
    )
    expect(created.status).toEqual(201)
    const firstId = created.data.person_property?.id

    const updated = await api.post(
      url(censusId),
      { custom_fields: { loom_type: "frame" } },
      auth
    )

    /*
     * 200, not 201: the route distinguishes them, and that distinction was
     * meaningless while `existing` was always truthy. Same id is the real
     * assertion — a second row under one census_id would break the 1:1
     * upsert the whole surface is built on.
     */
    expect(updated.status).toEqual(200)
    expect(updated.data.person_property?.id).toEqual(firstId)

    const read = await api.get(url(censusId), auth)
    expect(read.data.person_property?.id).toEqual(firstId)
    expect(read.data.person_property?.custom_fields?.loom_type).toEqual("frame")
  })
})
