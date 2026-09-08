import { ADMIN_MCP_TOOLS } from "../registry"
import { toolDomain } from "../tool-slice"

/**
 * A tool that DEMANDS an identifier must be reachable from a tool that
 * PRODUCES it — the rule the stock-location spec pinned first.
 *
 * Regions, sales channels and payment submissions were the next three ids in
 * that position. A region id is needed to price a cart or quote; a product is
 * only purchasable through a sales channel it is linked to; and the payout
 * tools (link_payment_to_payout, unlink_payment_from_payout,
 * apply_partner_credit) all take a payment submission id. Nothing listed any
 * of the three, so the only way to supply the id was to be handed it out of
 * band — a gap that is invisible in the worst way: no tool errors, no schema
 * is wrong, the caller simply cannot begin.
 *
 * This spec pins the readers themselves: present, read-only, wrapping exactly
 * the routes they claim, every forwarded param advertised in the schema, and
 * classified into a slice — an unclassified tool loads in NO slice and may as
 * well not exist.
 */

const byName = new Map(ADMIN_MCP_TOOLS.map((t) => [t.name, t]))

/** Every property name a tool's input schema declares, at the top level. */
const schemaProps = (tool: any): string[] =>
  Object.keys(tool?.inputSchema?.properties ?? {})

/** The six readers, tool name -> the exact route each must wrap. */
const READERS: Record<string, string> = {
  list_regions: "/admin/regions",
  get_region: "/admin/regions/:id",
  list_sales_channels: "/admin/sales-channels",
  get_sales_channel: "/admin/sales-channels/:id",
  list_payment_submissions: "/admin/payment-submissions",
  get_payment_submission: "/admin/payment-submissions/:id",
}

describe("id producers are discoverable", () => {
  it("exposes all six tools", () => {
    for (const name of Object.keys(READERS)) {
      expect(byName.has(name)).toBe(true)
    }
  })

  it("wraps exactly the routes above", () => {
    for (const [name, path] of Object.entries(READERS)) {
      expect({ name, path: byName.get(name)?.path }).toEqual({ name, path })
    }
  })

  it("keeps them READ tools — these ids are looked up, never edited here", () => {
    for (const name of Object.keys(READERS)) {
      const tool: any = byName.get(name)
      expect(tool.method).toBe("GET")
      expect(tool.bodyParams).toBeUndefined()
      expect(tool.write).toBeUndefined()
      expect(tool.sensitive).toBeUndefined()
    }
  })

  it("declares every pathParam and queryParam in its input schema", () => {
    // The dispatcher forwards an allowlist: a param the schema does not
    // advertise is silently stripped, so the model cannot even send it.
    const undeclared: string[] = []
    for (const name of Object.keys(READERS)) {
      const tool: any = byName.get(name)
      const declared = schemaProps(tool)
      for (const p of [...(tool.pathParams ?? []), ...(tool.queryParams ?? [])]) {
        if (!declared.includes(p)) undeclared.push(`${name}.${p}`)
      }
    }
    expect(undeclared).toEqual([])
  })

  it("classifies every one into a domain — an unclassified tool loads in NO slice", () => {
    const unclassified = Object.keys(READERS).filter(
      (name) => !toolDomain(byName.get(name)!)
    )
    expect(unclassified).toEqual([])
  })

  it("rides the slices the asks that need these ids live in", () => {
    expect(toolDomain(byName.get("list_regions")!)).toBe("catalog")
    expect(toolDomain(byName.get("get_region")!)).toBe("catalog")
    expect(toolDomain(byName.get("list_sales_channels")!)).toBe("catalog")
    expect(toolDomain(byName.get("get_sales_channel")!)).toBe("catalog")
    expect(toolDomain(byName.get("list_payment_submissions")!)).toBe("money")
    expect(toolDomain(byName.get("get_payment_submission")!)).toBe("money")
  })

  it("names the three tools that need the payout id list_payment_submissions produces", () => {
    const description: string = byName.get("list_payment_submissions")!
      .description
    expect(description).toContain("link_payment_to_payout")
    expect(description).toContain("unlink_payment_from_payout")
    expect(description).toContain("apply_partner_credit")
  })
})
