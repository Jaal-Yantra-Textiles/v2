import designPartnersLink from "../../../../../links/design-partners-link"
import partnerPersonLink from "../../../../../links/partner-person"
import { PARTNER_ITEM_NODES, resolvePartnerItems } from "../items"

/*
 * 🔴 Keyed by the link's own `entryPoint`, never a hand-written table name.
 * Medusa abbreviates a long link table name, so a stub keyed on a guess
 * answers `[]` to a resolver that is working perfectly — which on this spine
 * reads as "this partner has no people", the exact untruth #1857 is about.
 */
const DESIGN_ENTRY = designPartnersLink.entryPoint
const PERSON_ENTRY = partnerPersonLink.entryPoint

const stubQuery = (byEntity: Record<string, any[]>) => ({
  graph: jest.fn(async ({ entity }: { entity: string }) => ({
    data: byEntity[entity] ?? [],
  })),
})

const ctx = (query: any) => ({
  scope: { resolve: () => query },
  id: "pt_1",
})

describe("the partner node registry", () => {
  it("answers an unknown node with an empty list and asks nothing", async () => {
    const query = stubQuery({})
    await expect(resolvePartnerItems(ctx(query), "not_a_node")).resolves.toEqual([])
    expect(query.graph).not.toHaveBeenCalled()
  })

  it("advertises the nodes it can resolve", () => {
    expect(PARTNER_ITEM_NODES).toEqual(
      expect.arrayContaining([
        "admins",
        "designs",
        "runs",
        "submissions",
        "payment_methods",
        "people",
      ])
    )
  })
})

/**
 * The REMOVE descriptors (#1856).
 *
 * Both point at an endpoint that already exists, and the two take different
 * shapes — a POST with the partner in the body against the DESIGN's route, and
 * a DELETE that carries a body. A wrong shape here is a well-formed request to
 * the wrong record: nothing throws, nothing renders red, and the row vanishes
 * from the drawer either way. So they are asserted, not eyeballed.
 */
describe("people — unlink", () => {
  it("names the partner's own people route, with the id in the body", async () => {
    const query = stubQuery({
      [PERSON_ENTRY]: [{ person_id: "per_1" }],
      person: [{ id: "per_1", first_name: "Asha", last_name: "R", email: "a@x.com" }],
    })

    const [item] = await resolvePartnerItems(ctx(query), "people")

    expect(item.id).toBe("per_1")
    expect(item.remove).toEqual({
      method: "DELETE",
      path: "/admin/partners/pt_1/people",
      body: { person_ids: ["per_1"] },
      label: "Unlink",
      confirm: expect.stringContaining("Asha R"),
    })
  })

  it("says the person record survives, because the row beside it does not", async () => {
    /*
     * 🔴 The two removals in this drawer are not equivalent: this dismisses a
     * link, while "Cancel assignment" one node over cancels live production.
     * A shared "Are you sure?" would describe the milder of them.
     */
    const query = stubQuery({
      [PERSON_ENTRY]: [{ person_id: "per_1" }],
      person: [{ id: "per_1", first_name: "Asha", last_name: "R" }],
    })
    const [item] = await resolvePartnerItems(ctx(query), "people")
    expect(item.remove!.confirm).toContain("person record is untouched")
  })
})

describe("designs — cancel assignment", () => {
  const linked = {
    [DESIGN_ENTRY]: [{ design_id: "des_1" }],
    designs: [{ id: "des_1", name: "Kurta", status: "In_Development" }],
  }

  it("posts to the DESIGN's route with this partner in the body", async () => {
    const query = stubQuery({ ...linked, production_runs: [] })

    const [item] = await resolvePartnerItems(ctx(query), "designs")

    // 🔴 The design's id in the path, the partner's in the body — the same
    // endpoint the design spine uses, with the two ids the other way round.
    expect(item.remove!.method).toBe("POST")
    expect(item.remove!.path).toBe("/admin/designs/des_1/cancel-partner-assignment")
    expect(item.remove!.body).toEqual({ partner_id: "pt_1", unlink: true })
  })

  it("says Unlink, and says no runs are affected, when none are live", async () => {
    const query = stubQuery({
      ...linked,
      production_runs: [{ id: "pr_1", design_id: "des_1", status: "completed" }],
    })
    const [item] = await resolvePartnerItems(ctx(query), "designs")
    expect(item.remove!.label).toBe("Unlink")
    expect(item.remove!.confirm).toContain("No live runs")
  })

  it("says Cancel assignment, and the sentence agrees with the label", async () => {
    const query = stubQuery({
      ...linked,
      production_runs: [
        { id: "pr_1", design_id: "des_1", status: "in_progress" },
        { id: "pr_2", design_id: "des_1", status: "cancelled" },
        { id: "pr_3", design_id: "des_1", status: "accepted" },
      ],
    })
    const [item] = await resolvePartnerItems(ctx(query), "designs")
    expect(item.remove!.label).toBe("Cancel assignment")
    /*
     * 🔴 The sentence must not open with "Unlink" while the button says
     * "Cancel assignment" — it did on the first pass, and the milder of the
     * two words is the one the reader would have believed.
     */
    expect(item.remove!.confirm).toMatch(/^Cancel this partner's assignment/)
    expect(item.remove!.confirm).toContain("2 live runs")
  })

  it("ignores the partner's runs on OTHER designs", async () => {
    /*
     * The runs are fetched by partner, not by design, so every row this
     * partner has comes back at once. Counting them all would tell the reader
     * that unlinking one design cancels work on another.
     */
    const query = stubQuery({
      ...linked,
      production_runs: [
        { id: "pr_1", design_id: "des_OTHER", status: "in_progress" },
        { id: "pr_2", design_id: "des_1", status: "in_progress" },
      ],
    })
    const [item] = await resolvePartnerItems(ctx(query), "designs")
    expect(item.remove!.confirm).toContain("1 live run of theirs")
    expect(item.props).toContainEqual({ key: "live runs", value: "1" })
  })
})

describe("what deliberately carries no removal", () => {
  it.each([
    ["runs", { production_runs: [{ id: "pr_1", status: "completed" }] }],
    [
      "admins",
      { partners: [{ id: "pt_1", admins: [{ id: "pa_1", email: "a@x.com" }] }] },
    ],
  ])("%s offers none", async (node, data) => {
    /*
     * 🔴 Asserted rather than left implicit. `admins` and `payment_methods`
     * have no delete route at all — only POST and PATCH exist — so a bin icon
     * here would have to invent a destructive path the platform does not have.
     */
    const items = await resolvePartnerItems(ctx(stubQuery(data as any)), node)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.remove === null)).toBe(true)
  })
})
