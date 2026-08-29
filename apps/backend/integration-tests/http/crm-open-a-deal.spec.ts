/**
 * Opening a deal (#1552).
 *
 *   POST /admin/crm/opportunities   — now via createOpportunityWorkflow
 *   GET  /admin/crm/opportunities   — what the pipeline board reads
 *
 * ## Why an integration test
 *
 * The defect was that NOTHING could write this collection: the route had no
 * caller, and `createOpportunityWorkflow` had zero callers anywhere in `src/`.
 * Prod carries 234 contacts and 0 opportunities. A unit test cannot show that a
 * deal now reaches the board, nor that the workflow's side effect — moving the
 * originating lead to `qualified` — actually fires, because that side effect
 * spans two modules and only exists once the route goes through the workflow.
 *
 * ⚠️ Runs against the EMBEDDED Hyperbee store (integration-tests/setup.js),
 * which is a FILE the snapshot restore does not reset. CRM rows ACCUMULATE
 * across a run, so every case asserts on rows it created — identified by a
 * unique title — never on a total count.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { SOCIALS_MODULE } from "../../src/modules/socials"
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

  const marker = () => `deal${Date.now()}${Math.floor(Math.random() * 1e6)}`

  const openDeal = (body: Record<string, any>) =>
    api
      .post("/admin/crm/opportunities", body, adminHeaders)
      .catch((e: any) => e.response)

  async function findDeal(title: string) {
    const res = await api.get(
      "/admin/crm/opportunities?limit=100",
      adminHeaders
    )
    expect(res.status).toBe(200)
    return res.data.crm_opportunities.find((o: any) => o.title === title)
  }

  it("🔴 the CRM module is up — every case below is meaningless otherwise", async () => {
    const res = await api
      .get("/admin/crm/opportunities?limit=1", adminHeaders)
      .catch((e: any) => e.response)

    expect(res.status).toBe(200)
  })

  it("opens a deal and puts it on the board", async () => {
    // The whole issue: before this, the only rows that could exist were ones
    // somebody made by hand with curl.
    const title = marker()

    const res = await openDeal({
      title,
      stage: "sampling",
      amount: 125000,
      currency: "INR",
    })
    expect(res.status).toBe(201)
    expect(res.data.crm_opportunity.title).toBe(title)

    const onBoard = await findDeal(title)

    expect(onBoard).toBeTruthy()
    expect(onBoard.stage).toBe("sampling")
    expect(Number(onBoard.amount)).toBe(125000)
  })

  it("defaults a deal with no stage to the first column", async () => {
    const title = marker()

    const res = await openDeal({ title })
    expect(res.status).toBe(201)

    expect((await findDeal(title)).stage).toBe("prospecting")
  })

  it("refuses a stage outside the shared vocabulary", async () => {
    // The enum is enforced in two processes — Medusa on the way in and the
    // standalone node against its own bundled copy. This is the near end.
    const res = await openDeal({ title: marker(), stage: "wishful_thinking" })

    expect(res.status).toBe(400)
  })

  it("refuses a deal with no title", async () => {
    const res = await openDeal({ stage: "prospecting" })

    expect(res.status).toBe(400)
  })

  it("carries the contact and company the create surface prefills", async () => {
    const title = marker()
    const person = await api.post(
      "/admin/crm/people",
      { first_name: "Deal", last_name: marker() },
      adminHeaders
    )
    const company = await api.post(
      "/admin/crm/companies",
      { name: `Co ${marker()}` },
      adminHeaders
    )

    const res = await openDeal({
      title,
      owner_person_id: person.data.crm_person.id,
      company_id: company.data.crm_company.id,
    })
    expect(res.status).toBe(201)

    const onBoard = await findDeal(title)

    // The board resolves these ids to names; an unresolvable one renders as a
    // raw ULID, which is why the form offers pickers rather than id fields.
    expect(onBoard.owner_person_id).toBe(person.data.crm_person.id)
    expect(onBoard.company_id).toBe(company.data.crm_company.id)
  })

  // ─── the lead → opportunity loop ──────────────────────────────────────────

  /** A lead already imported into the CRM, as the import route leaves it. */
  async function createImportedLead(crmPersonId: string, status: string) {
    const socials: any = getContainer().resolve(SOCIALS_MODULE)
    const [lead] = await socials.createLeads([
      {
        meta_lead_id: `meta-${marker()}`,
        email: `lead-${marker()}@jyt.test`,
        full_name: "Imported Lead",
        created_time: new Date(),
        status,
        external_system: "crm",
        external_id: crmPersonId,
      },
    ])
    return lead
  }

  const readLead = async (id: string) => {
    const socials: any = getContainer().resolve(SOCIALS_MODULE)
    const [lead] = await socials.listLeads({ id })
    return lead
  }

  it("🔴 moves the originating lead to qualified — the act the import route deferred to", async () => {
    // "Promoting a lead is the act of working it… Deliberately NOT `qualified`:
    // importing a contact is not a judgement that the deal is real — that is
    // what opening an opportunity means." The act did not exist, so no lead
    // could ever reach `qualified`.
    const person = await api.post(
      "/admin/crm/people",
      { first_name: "Lead", last_name: marker() },
      adminHeaders
    )
    const personId = person.data.crm_person.id
    const lead = await createImportedLead(personId, "contacted")

    const res = await openDeal({ title: marker(), owner_person_id: personId })
    expect(res.status).toBe(201)

    expect((await readLead(lead.id)).status).toBe("qualified")
  })

  it("🔴 does not walk a terminal lead backwards", async () => {
    // A second deal for one contact is a normal thing to open, and it must not
    // undo the first one's outcome. `converted` means they became a customer.
    //
    // This case found a real defect: the first version skipped `qualified` and
    // `won`, and `won` is not a lead status at all — so the clause protected
    // nothing and every terminal status was promoted. The guard is an
    // ALLOWLIST of what to promote FROM now.
    for (const terminal of ["converted", "lost", "unqualified", "archived"]) {
      const person = await api.post(
        "/admin/crm/people",
        { first_name: "Terminal", last_name: marker() },
        adminHeaders
      )
      const personId = person.data.crm_person.id
      const lead = await createImportedLead(personId, terminal)

      const res = await openDeal({ title: marker(), owner_person_id: personId })
      expect(res.status).toBe(201)

      expect((await readLead(lead.id)).status).toBe(terminal)
    }
  })

  it("promotes a lead that is still `new`", async () => {
    const person = await api.post(
      "/admin/crm/people",
      { first_name: "New", last_name: marker() },
      adminHeaders
    )
    const personId = person.data.crm_person.id
    const lead = await createImportedLead(personId, "new")

    const res = await openDeal({ title: marker(), owner_person_id: personId })
    expect(res.status).toBe(201)

    expect((await readLead(lead.id)).status).toBe("qualified")
  })

  it("opens a deal for a contact with no lead behind it", async () => {
    // Most contacts have no lead. The side effect is best-effort by design —
    // the opportunity is what the user asked for.
    const person = await api.post(
      "/admin/crm/people",
      { first_name: "Leadless", last_name: marker() },
      adminHeaders
    )
    const title = marker()

    const res = await openDeal({
      title,
      owner_person_id: person.data.crm_person.id,
    })

    expect(res.status).toBe(201)
    expect(await findDeal(title)).toBeTruthy()
  })

  it("leaves another contact's lead alone", async () => {
    /**
     * ⚠️ Created SEQUENTIALLY, deliberately. Two concurrent creates against the
     * embedded single-writer Hyperbee store can be handed the SAME id — the key
     * sequence is not allocated atomically under concurrency — and then this
     * case passes for the wrong reason, because both contacts really are one.
     */
    const mine = await api.post(
      "/admin/crm/people",
      { first_name: "Mine", last_name: marker() },
      adminHeaders
    )
    const theirs = await api.post(
      "/admin/crm/people",
      { first_name: "Theirs", last_name: marker() },
      adminHeaders
    )
    expect(mine.data.crm_person.id).not.toBe(theirs.data.crm_person.id)
    const theirLead = await createImportedLead(
      theirs.data.crm_person.id,
      "contacted"
    )

    const res = await openDeal({
      title: marker(),
      owner_person_id: mine.data.crm_person.id,
    })
    expect(res.status).toBe(201)

    expect((await readLead(theirLead.id)).status).toBe("contacted")
  })
})
