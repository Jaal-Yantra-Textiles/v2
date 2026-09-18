import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { resolvePartnerDesignIds } from "../whatsapp-freeform-chat"

/**
 * Which designs a partner may be told about.
 *
 * 🔴 The bug this replaces: both design reads used
 * `entity: "designs", filters: { partner_id }` — and the design model has **no
 * `partner_id`**. It carries `owner_partner_id`, and designs reach a partner
 * through `links/design-partners-link.ts`.
 *
 * So the filter either did nothing — any partner could read any design by name
 * — or it threw, leaving the assistant permanently blind to designs. Both reads
 * sat behind `.catch(() => [])` and a bare `catch {}`, which made the leak and
 * the blindness produce the **same empty array**. Nobody could have told which
 * from a log.
 *
 * These tests pin the shape of the QUERIES, not just the result, because the
 * original bug was invisible in the result.
 */
describe("resolvePartnerDesignIds", () => {
  const PARTNER = "partner_ksaman"
  /** Stands in for the real link entry point, which is empty outside a container. */
  const LINK = async () => "design_partners_link"

  const makeScope = (graph: jest.Mock) => ({
    resolve: (key: any) => {
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === ContainerRegistrationKeys.LOGGER) {
        return { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
      }
      return undefined
    },
  })

  it("🔴 never filters designs on a `partner_id` field that does not exist", async () => {
    const graph = jest.fn(async () => ({ data: [] }))
    await resolvePartnerDesignIds(makeScope(graph), PARTNER, undefined, LINK)

    for (const call of graph.mock.calls) {
      const filters = (call[0] as any).filters ?? {}
      if ((call[0] as any).entity === "designs" || (call[0] as any).entity === "design") {
        expect(filters).not.toHaveProperty("partner_id")
      }
    }
  })

  it("resolves linked designs through the design↔partner LINK, scoped to the partner", async () => {
    const graph = jest.fn(async (arg: any) => {
      if (arg.entity === "design") return { data: [] }
      return { data: [{ design_id: "design_a" }, { design_id: "design_b" }] }
    })
    const ids = await resolvePartnerDesignIds(makeScope(graph), PARTNER, undefined, LINK)
    expect(ids.sort()).toEqual(["design_a", "design_b"])

    const linkCall = graph.mock.calls.find((c: any) => c[0].entity !== "design")
    expect((linkCall![0] as any).filters).toEqual({ partner_id: PARTNER })
  })

  it("also includes designs the partner OWNS, via owner_partner_id", async () => {
    const graph = jest.fn(async (arg: any) => {
      if (arg.entity === "design") return { data: [{ id: "design_owned" }] }
      return { data: [] }
    })
    const ids = await resolvePartnerDesignIds(makeScope(graph), PARTNER, undefined, LINK)
    expect(ids).toEqual(["design_owned"])

    const ownedCall = graph.mock.calls.find((c: any) => c[0].entity === "design")
    expect((ownedCall![0] as any).filters).toEqual({ owner_partner_id: PARTNER })
  })

  it("de-duplicates a design that is both linked and owned", async () => {
    const graph = jest.fn(async (arg: any) => {
      if (arg.entity === "design") return { data: [{ id: "design_a" }] }
      return { data: [{ design_id: "design_a" }] }
    })
    expect(await resolvePartnerDesignIds(makeScope(graph), PARTNER, undefined, LINK)).toEqual(["design_a"])
  })

  it("🔴 a failing link query LOGS rather than silently reading as 'no designs'", async () => {
    const warn = jest.fn()
    const scope = {
      resolve: (key: any) => {
        if (key === ContainerRegistrationKeys.QUERY) {
          return {
            graph: jest.fn(async () => {
              throw new Error("boom")
            }),
          }
        }
        if (key === ContainerRegistrationKeys.LOGGER) return { warn }
        return undefined
      },
    }
    const ids = await resolvePartnerDesignIds(scope, PARTNER, { warn }, LINK)
    expect(ids).toEqual([])
    // The whole point: an empty result caused by a BROKEN query must be
    // distinguishable from an empty result caused by no designs.
    expect(warn).toHaveBeenCalled()
  })

  it("survives one source failing and still returns the other", async () => {
    const graph = jest.fn(async (arg: any) => {
      if (arg.entity === "design") throw new Error("owned lookup down")
      return { data: [{ design_id: "design_a" }] }
    })
    expect(await resolvePartnerDesignIds(makeScope(graph), PARTNER, undefined, LINK)).toEqual(["design_a"])
  })

  it("ignores malformed rows rather than emitting empty ids", async () => {
    const graph = jest.fn(async (arg: any) => {
      if (arg.entity === "design") return { data: [{ id: null }, {}] }
      return { data: [{ design_id: "" }, { nope: 1 }, { design_id: "design_a" }] }
    })
    expect(await resolvePartnerDesignIds(makeScope(graph), PARTNER, undefined, LINK)).toEqual(["design_a"])
  })
})
