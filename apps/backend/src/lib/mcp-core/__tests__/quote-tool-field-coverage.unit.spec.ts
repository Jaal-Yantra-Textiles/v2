/**
 * The quote tools' vocabulary, checked against the validators that enforce it
 * (#1439, #1348).
 *
 * ## Why this is not covered by the file next door
 *
 * `route-validator-field-coverage.unit.spec.ts` resolves each tool's real
 * validator out of `middlewares.ts` and compares it to `bodyParams`. That is
 * the important check and it now covers these tools too. What it cannot see is
 * everything ROUND the body list:
 *
 * - `quoteMintSchemaProps()` is a separate object. A field can be in
 *   `bodyParams` and have no JSON-Schema property, in which case the model is
 *   never told it exists — and the #1371 required-args gate is blind to it,
 *   because that gate reads the tool's own `required` list, which is precisely
 *   the thing that would be wrong (#1394).
 * - The preflight body is `omit()`ed from the mint shape in the validator and
 *   filtered from the mint list here. Two subtractions, done in two places,
 *   that must produce the same set — or the preflight validates a shape the
 *   mint rejects and tells a partner their quote is ready before refusing it.
 * - `partner_id` must be on the admin tools and must NOT be on the partner
 *   ones. A partner naming another partner's id is the single field that would
 *   let them freeze prices onto someone else's customer group.
 *
 * ## The failure mode being guarded
 *
 * The dispatcher's body assembly is a pure allowlist walk. A field the model
 * supplies that is missing from `bodyParams` is dropped in **silence**: no
 * error, `ok: true`, and a quote minted on terms nobody chose. `dry_run` cannot
 * reveal it either, because the plan is rendered from the already-picked body.
 * Every assertion below exists because that failure is invisible at runtime.
 */

import { PARTNER_MCP_TOOLS } from "../../../api/partners/mcp/lib/registry"
import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"
import {
  PartnerMintQuoteShape,
  QuoteLineShape,
  QuoteReadinessShape,
} from "../../../api/partners/quotes/validators"
import {
  QUOTE_MINT_BODY_PARAMS,
  QUOTE_MINT_READINESS_BODY_PARAMS,
  QUOTE_MINT_WRITE_GUIDANCE,
  quoteMintSchemaProps,
  quoteReadinessSchemaProps,
} from "../../../modules/partner-quote/tool-schema"
import type { McpToolDef } from "../types"

const find = (tools: McpToolDef[], name: string): McpToolDef => {
  const tool = tools.find((t) => t.name === name)
  if (!tool) {
    throw new Error(`tool ${name} is not registered`)
  }
  return tool
}

/** Keys the Zod schema actually accepts, read off the schema itself. */
const shapeKeys = (schema: any): string[] => Object.keys(schema.shape)

describe("quote MCP tools — the body vocabulary matches its validators (#1439)", () => {
  describe("the mint body", () => {
    it("advertises exactly what the validator accepts", () => {
      // Both directions. A stray is a guaranteed 400 (`zodValidator` forces
      // `.strict()`); a missing one is the silent strip.
      expect([...QUOTE_MINT_BODY_PARAMS].sort()).toEqual(
        shapeKeys(PartnerMintQuoteShape).sort()
      )
    })

    it("describes every field it forwards", () => {
      // A field in `bodyParams` with no schema property is one the model is
      // never told about, so it can only ever be sent by accident.
      const described = Object.keys(quoteMintSchemaProps())
      expect([...QUOTE_MINT_BODY_PARAMS].sort()).toEqual(described.sort())
    })

    it("describes nothing it cannot forward", () => {
      for (const key of Object.keys(quoteMintSchemaProps())) {
        expect(QUOTE_MINT_BODY_PARAMS).toContain(key)
      }
    })

    /**
     * 🔴 The checks above are all TOP-LEVEL, and a quote's real vocabulary is
     * mostly inside a line. That blind spot cost `unit_weight_grams`: the
     * validator accepted it, the dispatcher forwarded it (the allowlist walks
     * the body, not the line), and the tool schema never mentioned it — so the
     * model was never told the one field a DESIGN line cannot be priced
     * without. Freight is rated on the summed basket weight and refuses the
     * whole basket on the first line it cannot weigh, and a design has no
     * weight of its own. The tool could describe a design quote it could never
     * successfully mint.
     */
    it("describes every field a LINE accepts", () => {
      const described = Object.keys(
        (quoteMintSchemaProps() as any).lines.items.properties
      )
      expect(described.sort()).toEqual(Object.keys(QuoteLineShape.shape).sort())
    })

    it("tells the model how a design line differs", () => {
      // The two refusals a design line hits that a variant line never does.
      expect(QUOTE_MINT_WRITE_GUIDANCE).toContain("unit_weight_grams")
      expect(QUOTE_MINT_WRITE_GUIDANCE).toContain("design_id")
    })
  })

  describe("the readiness body", () => {
    it("subtracts exactly what the validator subtracts", () => {
      /**
       * 🔴 The two subtractions are done in different files by different
       * mechanisms — `QuoteReadinessShape.omit({...})` there, a `filter` here.
       * This is the only thing keeping them equal. If the validator ever keeps
       * a field this drops, the preflight passes a basket the mint then
       * refuses; the partner is told they are ready and then told they are not.
       */
      expect([...QUOTE_MINT_READINESS_BODY_PARAMS].sort()).toEqual(
        shapeKeys(QuoteReadinessShape).sort()
      )
    })

    it("keeps freight_override_amount, which decides whether the lane must be rateable", () => {
      // Dropping it would make the preflight refuse exactly the cross-border
      // quotes an override exists to unblock.
      expect(QUOTE_MINT_READINESS_BODY_PARAMS).toContain("freight_override_amount")
    })

    it("describes exactly the fields it forwards", () => {
      expect([...QUOTE_MINT_READINESS_BODY_PARAMS].sort()).toEqual(
        Object.keys(quoteReadinessSchemaProps()).sort()
      )
    })
  })

  describe.each([
    ["partner", PARTNER_MCP_TOOLS as McpToolDef[], false],
    ["admin", ADMIN_MCP_TOOLS as McpToolDef[], true],
  ])("the %s surface", (_surface, tools, isAdmin) => {
    it("registers the four read/write quote tools", () => {
      for (const name of [
        "list_quotes",
        "get_quote",
        "check_quote_readiness",
        "mint_quote",
      ]) {
        expect(find(tools, name)).toBeTruthy()
      }
    })

    it("forwards the shared mint vocabulary", () => {
      const mint = find(tools, "mint_quote")
      for (const key of QUOTE_MINT_BODY_PARAMS) {
        expect(mint.bodyParams).toContain(key)
      }
    })

    it("offers every forwarded field in its input schema", () => {
      /**
       * The #1348 direction: `bodyParams ⊆ inputSchema`. A key the dispatcher
       * would forward but the model is never shown is unreachable — the tool
       * cannot be called correctly, and nothing says so.
       */
      for (const name of ["mint_quote", "check_quote_readiness"]) {
        const tool = find(tools, name)
        const props = Object.keys((tool.inputSchema as any).properties ?? {})
        for (const key of tool.bodyParams ?? []) {
          expect(props).toContain(key)
        }
      }
    })

    it("marks minting sensitive, and the rehearsal not", () => {
      // Minting emails a buyer a number. The preflight writes nothing, and a
      // confirm-gate on it is how an assistant skips it and mints blind.
      expect(find(tools, "mint_quote").sensitive).toBe(true)
      expect(find(tools, "check_quote_readiness").sensitive).toBeFalsy()
    })

    it(
      isAdmin
        ? "requires partner_id, because an admin has no partner of their own"
        : "🔴 never accepts partner_id — it would let a partner price onto another's customers",
      () => {
        for (const name of ["mint_quote", "check_quote_readiness"]) {
          const tool = find(tools, name)
          const props = Object.keys((tool.inputSchema as any).properties ?? {})
          if (isAdmin) {
            expect(tool.bodyParams).toContain("partner_id")
            expect(props).toContain("partner_id")
            expect((tool.inputSchema as any).required).toContain("partner_id")
          } else {
            expect(tool.bodyParams).not.toContain("partner_id")
            expect(props).not.toContain("partner_id")
          }
        }
      }
    )

    it("requires the fields a quote cannot be built without", () => {
      const required = (find(tools, "mint_quote").inputSchema as any).required
      for (const key of [
        "buyer_email",
        "lines",
        "destination_country_code",
        "currency_code",
      ]) {
        expect(required).toContain(key)
      }
    })
  })

  /**
   * This assertion used to read "only the admin surface can revoke", on the
   * reasoning that revocation reaches across partners. That conflated the
   * ADMIN ROUTE's reach with the capability: a partner withdrawing their OWN
   * quote reaches nobody else, and denying it meant a mis-quote could only be
   * corrected by re-minting — which emails the buyer a second number — or by
   * waiting for expiry. #1517 built the route; the tool follows it.
   */
  it("both surfaces can revoke, and both treat it as sensitive", () => {
    for (const tools of [ADMIN_MCP_TOOLS, PARTNER_MCP_TOOLS] as McpToolDef[][]) {
      const tool = find(tools, "revoke_quote")
      expect(tool.write).toBe(true)
      // The buyer has already been told a number by the time anyone revokes.
      expect(tool.sensitive).toBe(true)
      // 🔴 No body on either. The dispatcher's body assembly is an allowlist
      // walk, so a `reason` field the route never reads would be accepted,
      // reported `ok: true`, and dropped in silence (#1348).
      expect(tool.bodyParams).toBeUndefined()
    }
  })

  it("the partner's revoke names no partner_id — it is scoped by the caller", () => {
    // The single field that would let a partner reach another partner's quote.
    const tool = find(PARTNER_MCP_TOOLS as McpToolDef[], "revoke_quote")
    expect(Object.keys((tool.inputSchema as any).properties)).toEqual(["id"])
  })
})
