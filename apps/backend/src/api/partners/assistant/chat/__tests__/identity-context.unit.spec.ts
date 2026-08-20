/**
 * The identity block's WORDING is the mechanism (#1392), so it is what gets
 * pinned.
 *
 * The point of injecting identity server-side is to stop the model spending a
 * round trip rediscovering its own caller. That only works if the block reads
 * as authoritative — a block the model does not trust is a block it calls
 * `list_stores` alongside anyway, which is the bug with extra tokens.
 */

import {
  formatPartnerIdentityBlock,
  resolvePartnerIdentity,
  type PartnerIdentity,
} from "../identity-context"

const base: PartnerIdentity = {
  id: "01PARTNER",
  name: "Sharlho",
  handle: "sharlho",
  workspace_type: "manufacturer",
  is_verified: true,
  country_code: "IN",
  stores: [],
}

describe("formatPartnerIdentityBlock", () => {
  it("returns nothing when identity could not be resolved", () => {
    // No block at all, rather than a block saying "unknown" — the model should
    // fall back to its tools, not be told a fact it cannot use.
    expect(formatPartnerIdentityBlock(null)).toBeUndefined()
  })

  it("carries the partner's own identifying facts", () => {
    const out = formatPartnerIdentityBlock(base)!
    expect(out).toContain("01PARTNER")
    expect(out).toContain("Sharlho")
    expect(out).toContain("manufacturer")
  })

  it("tells the model not to look up what it was just given", () => {
    const out = formatPartnerIdentityBlock(base)!.toLowerCase()
    expect(out).toContain("do not look it up")
  })

  describe("with exactly one store", () => {
    const one = {
      ...base,
      stores: [
        {
          id: "store_1",
          name: "Sharlho Store",
          default_sales_channel_id: "sc_1",
          default_location_id: "sloc_1",
          default_currency_code: "inr",
        },
      ],
    }

    it("hands over every id a store-scoped tool needs", () => {
      const out = formatPartnerIdentityBlock(one)!
      expect(out).toContain("store_1")
      expect(out).toContain("sc_1")
      expect(out).toContain("sloc_1")
      expect(out).toContain("inr")
    })

    it("forbids asking which store when there is only one", () => {
      // The failure this exists to prevent: asking a partner to choose between
      // the single store they own, which reads as not knowing who they are.
      const out = formatPartnerIdentityBlock(one)!
      expect(out).toContain("ONE store")
      expect(out.toLowerCase()).toContain("without asking which store")
    })
  })

  describe("with several stores", () => {
    const many = {
      ...base,
      stores: [
        { id: "store_1", name: "First" },
        { id: "store_2", name: "Second" },
      ],
    }

    it("lists them all", () => {
      const out = formatPartnerIdentityBlock(many)!
      expect(out).toContain("store_1")
      expect(out).toContain("store_2")
      expect(out).toContain("First")
      expect(out).toContain("Second")
    })

    it("still permits asking which — but by name, not by re-listing", () => {
      const out = formatPartnerIdentityBlock(many)!
      expect(out).toContain("DOES need the partner to say which")
      expect(out).toContain("Do not call `list_stores`")
    })
  })

  it("states plainly when the partner has no store", () => {
    // 13 partners on prod are in exactly this state. "No store" is a real
    // answer, and confirming it with a tool call is the wasted turn again.
    const out = formatPartnerIdentityBlock(base)!
    expect(out).toContain("NONE")
    expect(out.toLowerCase()).toContain("no store yet")
  })

  it("omits fields the partner has not filled rather than printing blanks", () => {
    const sparse = formatPartnerIdentityBlock({
      id: "01P",
      stores: [],
    } as PartnerIdentity)!
    expect(sparse).not.toContain("name:")
    expect(sparse).not.toContain("null")
    expect(sparse).not.toContain("undefined")
  })
})

describe("resolvePartnerIdentity", () => {
  const container = (graph: any) => ({ resolve: () => ({ graph }) })

  it("returns null without a partner id, without touching the container", async () => {
    const graph = jest.fn()

    await expect(resolvePartnerIdentity(container(graph), null)).resolves.toBeNull()
    expect(graph).not.toHaveBeenCalled()
  })

  it("never throws when the query fails", async () => {
    // This only ever saves the model a lookup it can still do itself, so it
    // must not be able to fail the turn.
    const warn = jest.fn()
    const res = await resolvePartnerIdentity(
      container(() => {
        throw new Error("db down")
      }),
      "01P",
      { warn }
    )

    expect(res).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it("returns null when the partner row is gone", async () => {
    const res = await resolvePartnerIdentity(
      container(async () => ({ data: [] })),
      "01P"
    )
    expect(res).toBeNull()
  })

  it("drops store rows with no id rather than emitting a broken one", async () => {
    const res = await resolvePartnerIdentity(
      container(async () => ({
        data: [
          {
            id: "01P",
            stores: [{ id: "store_1", name: "Real" }, { name: "Ghost" }],
          },
        ],
      })),
      "01P"
    )

    expect(res!.stores).toEqual([
      expect.objectContaining({ id: "store_1", name: "Real" }),
    ])
  })
})
