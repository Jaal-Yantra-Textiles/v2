import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { fetchExchangeRate } from "../../../workflows/designs/create-draft-order-from-designs"
import { parseTargetCurrencies, buildRatesResponse } from "./parse"

/**
 * GET /admin/exchange-rates?from=INR&to=EUR,USD
 *
 * Server-side proxy for the Frankfurter API (ECB data). The admin UI must not
 * call api.frankfurter.app directly — the browser blocks it as a cross-origin
 * request ("Rate Fetching Failed", #501). This route fetches the rates on the
 * server (re-using the in-memory 1h cache in `fetchExchangeRate`) and returns a
 * `{ base, rates }` payload in the same shape the Frankfurter `/latest` endpoint
 * uses, so the admin hooks can swap a raw fetch() for sdk.client.fetch().
 *
 * Rates that fail to resolve for an individual target are omitted from `rates`
 * (the caller then falls back to a 1:1 amount), so a single bad currency never
 * fails the whole request.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const from = String(req.query.from || "").toUpperCase()

  if (!from) {
    return res.status(400).json({
      error: "Missing required query param: from",
    })
  }

  const targets = parseTargetCurrencies(req.query.to as string | undefined, from)

  if (targets.length === 0) {
    return res.json(buildRatesResponse(from, []))
  }

  const pairs = await Promise.all(
    targets.map(async (to): Promise<[string, number | null]> => {
      try {
        return [to, await fetchExchangeRate(from, to)]
      } catch {
        return [to, null]
      }
    })
  )

  return res.json(buildRatesResponse(from, pairs))
}
