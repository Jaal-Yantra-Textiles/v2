import { Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { PERSON_MODULE } from "../../src/modules/person"
import { AUDIENCE_MODULE } from "../../src/modules/audience"

jest.setTimeout(60 * 1000)

/**
 * Guards the #457/#881 audience backfill against the "keeps running / never
 * converges" regression: after the first apply materializes the entries, a
 * second apply with NO source changes must be a no-op (applied=false) because
 * every row is change-detected and skipped — not re-UPDATEd one-at-a-time.
 */
setupSharedTestSuite(() => {
  describe("backfill-audience-entries maintenance job", () => {
    let adminHeaders: { headers: Record<string, string> }
    const RUN = "/admin/ops/maintenance-jobs/backfill-audience-entries/run"

    beforeAll(async () => {
      await createAdminUser(getSharedTestEnv().getContainer())
      adminHeaders = await getAuthHeaders(getSharedTestEnv().api)
    })

    it("materializes entries, then a re-run converges to a no-op", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      const personEmail = `bf-aud-person-${unique}@jyt.test`
      const customerEmail = `bf-aud-customer-${unique}@jyt.test`

      const personService: any = container.resolve(PERSON_MODULE)
      const customerService: any = container.resolve(Modules.CUSTOMER)
      const audienceService: any = container.resolve(AUDIENCE_MODULE)

      await personService.createPeople({
        first_name: "Aud",
        last_name: "Person",
        email: personEmail,
        state: "Onboarding",
      })
      await customerService.createCustomers({
        first_name: "Aud",
        last_name: "Customer",
        email: customerEmail,
      })

      // ── First apply: creates the entries for our seeded sources ──────────
      const first = await api.post(RUN, { dry_run: false }, adminHeaders)
      expect(first.status).toBe(200)
      expect(first.data.result.applied).toBe(true)

      const seeded = await audienceService.listAudienceEntries({
        email: [personEmail, customerEmail],
      })
      const seededEmails = seeded.map((e: any) => e.email).sort()
      expect(seededEmails).toEqual([customerEmail, personEmail].sort())

      // ── Second apply, no source changes: must be a no-op (convergence) ───
      const second = await api.post(RUN, { dry_run: false }, adminHeaders)
      expect(second.status).toBe(200)
      expect(second.data.result.applied).toBe(false)

      const changeCount = (id: string) =>
        second.data.result.changes.find((c: any) => c.id === id)?.after
      expect(changeCount("created")).toBe(0)
      expect(changeCount("updated")).toBe(0)
      expect(changeCount("unchanged")).toBeGreaterThanOrEqual(2)

      // Row count is stable across the second run (nothing duplicated).
      const after = await audienceService.listAudienceEntries({
        email: [personEmail, customerEmail],
      })
      expect(after.length).toBe(2)
    })

    it("dry-run predicts an update after a source field changes, without writing", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = `${Date.now()}-2`

      const email = `bf-aud-update-${unique}@jyt.test`
      const customerService: any = container.resolve(Modules.CUSTOMER)
      const audienceService: any = container.resolve(AUDIENCE_MODULE)

      const [created] = await customerService.createCustomers([
        { first_name: "Before", last_name: "Name", email },
      ])

      // Materialize.
      await api.post(RUN, { dry_run: false }, adminHeaders)

      // Change the source name → the draft now differs from the persisted row.
      await customerService.updateCustomers(created.id, { first_name: "After" })

      // Dry-run must PREDICT one update and write nothing.
      const preview = await api.post(RUN, { dry_run: true }, adminHeaders)
      expect(preview.status).toBe(200)
      expect(preview.data.result.dry_run).toBe(true)
      expect(preview.data.result.applied).toBe(false)
      const updated = preview.data.result.changes.find((c: any) => c.id === "updated")?.after
      expect(updated).toBeGreaterThanOrEqual(1)

      // The persisted entry still has the OLD name (dry-run wrote nothing).
      const [entry] = await audienceService.listAudienceEntries({ email: [email] })
      expect(entry.first_name).toBe("Before")
    })
  })
})
