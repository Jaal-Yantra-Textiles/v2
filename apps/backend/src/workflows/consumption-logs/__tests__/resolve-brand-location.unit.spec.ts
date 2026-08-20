import { resolveBrandLocationId } from "../lib/apply-to-inventory"

/**
 * The brand-store heuristic, and the soft-delete hole that broke it on prod.
 *
 * `deletePartnerWorkflow` soft-deletes a partner and its admins and leaves
 * EVERYTHING else alone — the store, the sales channel, the stock location and
 * the partner↔store link all survive untouched. `query.graph` excludes
 * soft-deleted rows unless `withDeleted` is passed, so a deleted partner
 * disappears from the query while its store does not, and the store gets
 * counted as a second brand store.
 *
 * That is not hypothetical: the helper threw on prod ("found 2") until an
 * orphan store was removed, and it would have re-broken on the next partner
 * deletion.
 */

type GraphCall = { entity: string; withDeleted?: boolean }

const containerWith = (
  partners: any[],
  stores: any[],
  calls: GraphCall[] = []
) => ({
  resolve: () => ({
    graph: async (args: any) => {
      calls.push({ entity: args.entity, withDeleted: args.withDeleted })
      if (args.entity === "partners") {
        // Mimic the real default: soft-deleted rows are invisible unless asked for.
        const visible = args.withDeleted
          ? partners
          : partners.filter((p) => !p.deleted_at)
        return { data: visible }
      }
      return { data: stores }
    },
  }),
})

const BRAND = { id: "store_brand", default_location_id: "sloc_brand" }
const PARTNER_STORE = { id: "store_partner", default_location_id: "sloc_p" }

describe("resolveBrandLocationId", () => {
  it("returns the one store no partner reaches", async () => {
    const container = containerWith(
      [{ id: "p1", stores: [{ id: PARTNER_STORE.id }] }],
      [BRAND, PARTNER_STORE]
    )

    await expect(
      resolveBrandLocationId(container as any)
    ).resolves.toBe("sloc_brand")
  })

  it("still excludes the store of a SOFT-DELETED partner", async () => {
    // The regression. Before `withDeleted: true`, the deleted partner vanished
    // from the query, its surviving store looked unowned, and the count hit 2.
    const container = containerWith(
      [
        { id: "p1", stores: [{ id: PARTNER_STORE.id }] },
        {
          id: "p2",
          deleted_at: "2026-08-01T00:00:00.000Z",
          stores: [{ id: "store_of_deleted_partner" }],
        },
      ],
      [BRAND, PARTNER_STORE, { id: "store_of_deleted_partner" }]
    )

    await expect(
      resolveBrandLocationId(container as any)
    ).resolves.toBe("sloc_brand")
  })

  it("asks for deleted partners explicitly — the flag is opt-in, so omitting it is the bug", async () => {
    const calls: GraphCall[] = []
    const container = containerWith(
      [{ id: "p1", stores: [{ id: PARTNER_STORE.id }] }],
      [BRAND, PARTNER_STORE],
      calls
    )

    await resolveBrandLocationId(container as any)

    expect(calls.find((c) => c.entity === "partners")?.withDeleted).toBe(true)
  })

  it("throws, rather than guessing, when two stores look unowned", async () => {
    const container = containerWith(
      [{ id: "p1", stores: [{ id: PARTNER_STORE.id }] }],
      [BRAND, PARTNER_STORE, { id: "store_stray" }]
    )

    await expect(resolveBrandLocationId(container as any)).rejects.toThrow(
      /found 2/
    )
  })

  it("throws when none look unowned", async () => {
    const container = containerWith(
      [{ id: "p1", stores: [{ id: BRAND.id }, { id: PARTNER_STORE.id }] }],
      [BRAND, PARTNER_STORE]
    )

    await expect(resolveBrandLocationId(container as any)).rejects.toThrow(
      /found 0/
    )
  })

  it("throws when the brand store has no default location", async () => {
    const container = containerWith(
      [{ id: "p1", stores: [{ id: PARTNER_STORE.id }] }],
      [{ id: "store_brand", default_location_id: null }, PARTNER_STORE]
    )

    await expect(resolveBrandLocationId(container as any)).rejects.toThrow()
  })
})
