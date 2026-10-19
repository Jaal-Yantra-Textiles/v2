import { importLeadToCrm } from "../import-lead"

const scopeWith = (opts: { existingPersonId?: string } = {}) => {
  const updates: any[] = []
  const created: any[] = []
  const scope = {
    resolve: (key: string) =>
      key === "socials"
        ? { updateLeads: async (rows: any[]) => updates.push(...rows) }
        : {
            listCrmPeople: async () => (opts.existingPersonId ? [{ id: opts.existingPersonId }] : []),
            createCrmPeople: async (draft: any) => {
              created.push(draft)
              return { id: "crm_new" }
            },
          },
  }
  return { scope, updates, created }
}

const lead = { id: "lead_1", email: "asha.devi@story.test", status: "new" }

describe("importLeadToCrm", () => {
  it("creates a contact and stamps the lead, keeping a shopper's lead new", async () => {
    const { scope, updates, created } = scopeWith()
    const out = await importLeadToCrm(scope, lead, { markContacted: false })
    expect(out).toEqual({ action: "created", crm_person_id: "crm_new" })
    expect(created).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: "lead_1", external_id: "crm_new" })
    expect(updates[0].status).toBeUndefined()
  })

  it("an admin import marks the lead contacted (unchanged behaviour)", async () => {
    const { scope, updates } = scopeWith()
    await importLeadToCrm(scope, lead)
    expect(updates[0].status).toBe("contacted")
  })

  it("links to an existing contact with that email instead of duplicating", async () => {
    const { scope, created } = scopeWith({ existingPersonId: "crm_old" })
    const out = await importLeadToCrm(scope, lead, { markContacted: false })
    expect(out).toEqual({ action: "linked", crm_person_id: "crm_old" })
    expect(created).toHaveLength(0)
  })
})
