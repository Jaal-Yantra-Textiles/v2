import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { getPartnerStore } from "../../helpers"
import {
  resolveDesignLinesForReadiness,
  withDesignIssues,
} from "../../../../modules/partner-quote/lib/design-lines"
import { assessQuoteReadiness } from "../../../../modules/partner-quote/lib/quote-readiness"
import { makeDesignVariantPort } from "../../../../workflows/partner-quote/ensure-design-quote-variant"

/**
 * Can this basket be quoted? (#1445)
 *
 * A read-only dry run of everything `mintQuoteWorkflow` would refuse on, so
 * the wizard can show a blocking checklist instead of letting a partner press
 * mint and collect one error at a time.
 *
 * 🔑 POST, not GET, because the input is a basket — a list of variants and
 * quantities plus a destination — and putting that in a query string would
 * both hit URL limits on a real bulk quote and log the whole thing.
 *
 * 🔴 Writes NOTHING. That is the contract: this is what a partner or an
 * assistant is expected to call speculatively, repeatedly, before committing.
 * The moment it has a side effect, nobody can call it freely and it stops
 * being useful.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await getPartnerStore(req.auth_context, req.scope)
  const body = req.validatedBody as any

  // #1486 — a design line is resolved to its variant before the basket is
  // assessed, and an unresolvable one becomes a blocking row rather than a
  // throw. This endpoint's whole contract is "report, never refuse".
  const designs = await resolveDesignLinesForReadiness(req.scope, {
    lines: body.lines,
    partner_id: partner.id,
    // Lets a design with no product be previewed as made-to-order rather than
    // reported as a blocker. Prices nothing and creates nothing — the port is
    // called with `dry_run: true` from the readiness path.
    variant_port: makeDesignVariantPort(req.scope, {
      currency_code: body.currency_code,
      partner_id: partner.id,
      // Where the mint WOULD put it. Nothing is created here (`dry_run: true`).
      catalogue_sales_channel_id: (store as any).default_sales_channel_id,
    }),
    currency_code: body.currency_code,
  })

  const readiness = await assessQuoteReadiness(req.scope, {
    lines: designs.lines as any,
    store: {
      id: store.id,
      default_location_id: store.default_location_id,
      default_sales_channel_id: (store as any).default_sales_channel_id,
    },
    destination_country_code: body.destination_country_code,
    destination_postal_code: body.destination_postal_code ?? null,
    currency_code: body.currency_code,
    // #1439 S12 — a hand-named freight makes an unrateable lane assessable.
    freight_override_amount: body.freight_override_amount ?? null,
    region_id: body.region_id ?? null,
    carrier: body.carrier,
    partner_label: partner.name || partner.id,
    // The partner picks from their own catalogue, so a mismatch here means the
    // product left their sales channel after it was selected — worth saying.
    check_catalogue: true,
  })

  res.json({ readiness: withDesignIssues(readiness, designs.issues) })
}
