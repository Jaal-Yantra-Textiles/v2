/**
 * @file Partner API routes for managing currencies
 * @description Provides endpoints for retrieving currency information in the JYT Commerce platform
 * @module API/Partner/Currencies
 */

/**
 * @typedef {Object} PartnerCurrenciesQuery
 * @property {number} [limit=50] - Number of currencies to return (max 100)
 * @property {number} [offset=0] - Pagination offset
 */

/**
 * @typedef {Object} Currency
 * @property {string} code - The ISO 4217 currency code
 * @property {string} name - The name of the currency
 * @property {string} symbol - The symbol of the currency
 * @property {string} symbol_native - The native symbol of the currency
 * @property {number} decimal_digits - Number of decimal digits used
 * @property {boolean} is_active - Whether the currency is active
 * @property {Date} created_at - When the currency was created
 * @property {Date} updated_at - When the currency was last updated
 */

/**
 * @typedef {Object} PartnerCurrenciesResponse
 * @property {string} partner_id - The ID of the partner making the request
 * @property {Currency[]} currencies - Array of currency objects
 * @property {number} count - Total number of currencies available
 * @property {number} limit - Number of currencies returned in this response
 * @property {number} offset - Pagination offset used in this response
 */

/**
 * List currencies available to the partner
 * @route GET /partners/currencies
 * @group Currency - Operations related to currencies
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=50] - Number of currencies to return (max 100)
 * @returns {PartnerCurrenciesResponse} 200 - Paginated list of currencies available to the partner
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required
 * @throws {MedusaError} 401 - Unauthorized - No partner associated with this admin
 *
 * @example request
 * GET /partners/currencies?offset=0&limit=25
 *
 * @example response 200
 * {
 *   "partner_id": "partner_123456789",
 *   "currencies": [
 *     {
 *       "code": "USD",
 *       "name": "US Dollar",
 *       "symbol": "$",
 *       "symbol_native": "$",
 *       "decimal_digits": 2,
 *       "is_active": true,
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "code": "EUR",
 *       "name": "Euro",
 *       "symbol": "€",
 *       "symbol_native": "€",
 *       "decimal_digits": 2,
 *       "is_active": true,
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 167,
 *   "limit": 25,
 *   "offset": 0
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

type PartnerCurrenciesQuery = {
  limit?: number
  offset?: number
}

export const GET = async (
  req: AuthenticatedMedusaRequest<PartnerCurrenciesQuery>,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  const rawLimit = Number(req.query?.limit ?? 50)
  const rawOffset = Number(req.query?.offset ?? 0)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0

  const currencyModule = req.scope.resolve(Modules.CURRENCY)
  const [currencies, count] = await currencyModule.listAndCountCurrencies(
    {},
    {
      skip: offset,
      take: limit,
    }
  )

  return res.status(200).json({
    partner_id: partner.id,
    currencies,
    count,
    limit,
    offset,
  })
}