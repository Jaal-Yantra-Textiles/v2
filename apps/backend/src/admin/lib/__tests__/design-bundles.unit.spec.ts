import { buildBundleRows } from "../design-bundles"

const designs = {
  d_bag: { name: "Bag for Paris", status: "In_Development" },
  d_jt1: { name: "Jacket & Trouser - Design No 1 ", status: "In_Development" },
}
const partners = { p_shram: "Shramdaan", p_luck: "Lucknavi boutique" }

describe("buildBundleRows", () => {
  it("makes one bundle row per collated order with its designs as children", () => {
    const [bundle] = buildBundleRows(
      [
        {
          id: "order_1",
          display_id: 42,
          created_at: "2026-11-02T04:03:40Z",
          partner_status: "sent",
          runs: [
            { id: "run_a", design_id: "d_bag", partner_id: "p_shram", status: "sent_to_partner", quantity: 10 },
            { id: "run_b", design_id: "d_jt1", partner_id: "p_shram", status: "sent_to_partner", quantity: 2 },
          ],
        },
      ],
      designs,
      partners
    )
    expect(bundle).toMatchObject({
      kind: "bundle",
      label: "Order #42",
      partner: "Shramdaan",
      status: "sent",
      design_count: 2,
      pieces: 12,
    })
    expect(bundle.children.map((c) => [c.name, c.quantity, c.run_status])).toEqual([
      ["Bag for Paris", 10, "sent_to_partner"],
      ["Jacket & Trouser - Design No 1", 2, "sent_to_partner"],
    ])
  })

  it("scopes child ids by order so one design in two bundles stays two rows", () => {
    const rows = buildBundleRows(
      [
        { id: "o1", runs: [{ id: "r1", design_id: "d_bag", quantity: 1 }] },
        { id: "o2", runs: [{ id: "r2", design_id: "d_bag", quantity: 1 }] },
      ],
      designs,
      partners
    )
    const ids = rows.flatMap((r) => r.children.map((c) => c.id))
    expect(new Set(ids).size).toBe(2)
  })

  it("lists newest bundles first", () => {
    const rows = buildBundleRows(
      [
        { id: "old", created_at: "2026-10-01T00:00:00Z", runs: [] },
        { id: "new", created_at: "2026-11-02T00:00:00Z", runs: [] },
      ],
      designs,
      partners
    )
    expect(rows.map((r) => r.id)).toEqual(["new", "old"])
  })

  it("keeps a run whose design is not in the lookup, and names every partner", () => {
    const [b] = buildBundleRows(
      [
        {
          id: "o",
          runs: [
            { id: "r1", design_id: "d_missing", partner_id: "p_shram", quantity: 3 },
            { id: "r2", design_id: "d_bag", partner_id: "p_luck", quantity: null },
          ],
        },
      ],
      designs,
      partners
    )
    expect(b.design_count).toBe(2)
    expect(b.children[0].name).toBe("d_missing")
    expect(b.pieces).toBe(3)
    expect(b.partner).toBe("Shramdaan, Lucknavi boutique")
    expect(b.label).toBe("o")
  })
})
