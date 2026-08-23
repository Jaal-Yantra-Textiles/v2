import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { assessQuoteReadiness } from "../../../../modules/partner-quote/lib/quote-readiness"

/**
 * Can this basket be quoted, on a named partner's behalf? (#1445)
 *
 * The admin twin of `/partners/quotes/readiness`. Same assessor, one extra
 * input: an admin has no partner of their own, so `partner_id` is required and
 * the store is resolved from it.
 *
 * 🔴 `check_catalogue` matters far more here than on the partner surface. An
 * admin picks the partner from one dropdown and the variants from another, so
 * the two can disagree with a single mis-click — and nothing downstream
 * catches it: the price list is created successfully, its rule assertion
 * passes, and the buyer gets a working link to prices the partner never agreed
 * to sell at.
 *
 * Writes nothing.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as any
  const partnerId = String(body.partner_id || "").trim()

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: [
      "id",
      "name",
      "stores.id",
      "stores.default_location_id",
      "stores.default_sales_channel_id",
    ],
    filters: { id: partnerId },
  })

  const partner = partners?.[0] as any
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  const store = partner.stores?.[0]
  if (!store?.id) {
    // Answered as a readiness failure rather than thrown: "this partner has no
    // store" is exactly the kind of thing this endpoint exists to report, and
    // a 404 here would make the wizard show an error dialog instead of a
    // checklist row the admin can act on.
    return res.json({
      readiness: {
        ready: false,
        issues: [
          {
            code: "store_location_missing",
            severity: "blocking",
            message: `${partner.name || partnerId} has no store, so a quote cannot be priced for them.`,
          },
        ],
        blocking_count: 1,
        warning_count: 0,
        freight: { chosen: null, total_weight_grams: null, error: null },
      },
    })
  }

  const readiness = await assessQuoteReadiness(req.scope, {
    lines: body.lines,
    store: {
      id: store.id,
      default_location_id: store.default_location_id,
      default_sales_channel_id: store.default_sales_channel_id,
    },
    destination_country_code: body.destination_country_code,
    destination_postal_code: body.destination_postal_code ?? null,
    currency_code: body.currency_code,
    // #1439 S12 — a hand-named freight makes an unrateable lane assessable.
    freight_override_amount: body.freight_override_amount ?? null,
    region_id: body.region_id ?? null,
    carrier: body.carrier,
    partner_label: partner.name || partnerId,
    check_catalogue: true,
  })

  res.json({ readiness })
}
