import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { fetchExchangeRate } from "../../../workflows/designs/create-draft-order-from-designs"

/**
 * GET /admin/exchange-rate?from=INR&to=EUR
 *
 * Returns the current exchange rate between two currencies using the
 * Frankfurter API (ECB data). Rates are cached in-memory for 1 hour.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const from = String(req.query.from || "").toUpperCase()
  const to = String(req.query.to || "").toUpperCase()

  if (!from || !to) {
    return res.status(400).json({
      error: "Missing required query params: from, to",
    })
  }

  if (from === to) {
    return res.json({ from, to, rate: 1 })
  }

  try {
    const rate = await fetchExchangeRate(from, to)
    return res.json({ from, to, rate })
  } catch (err: any) {
    return res.status(502).json({
      error: "Failed to fetch exchange rate",
      details: err?.message || String(err),
    })
  }
}
