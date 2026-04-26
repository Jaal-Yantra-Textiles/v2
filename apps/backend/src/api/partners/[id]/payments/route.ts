/**
 * @file Partner Payments API routes
 * @description Provides endpoints for retrieving payment information linked to partners in the JYT Commerce platform
 * @module API/Partners/Payments
 */

/**
 * @typedef {Object} ListPaymentsByPartnerQuery
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=50] - Number of items to return
 */

/**
 * @typedef {Object} Payment
 * @property {string} id - The unique identifier for the payment
 * @property {string} partner_id - The ID of the partner associated with the payment
 * @property {string} amount - The payment amount
 * @property {string} currency - The currency of the payment
 * @property {string} status - The status of the payment (e.g., "paid", "pending", "failed")
 * @property {Date} created_at - When the payment was created
 * @property {Date} updated_at - When the payment was last updated
 */

/**
 * @typedef {Object} ListPaymentsResponse
 * @property {Payment[]} payments - Array of payment objects
 * @property {number} count - Total number of payments available
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Number of items returned
 */

/**
 * List all payments linked to a partner
 * @route GET /partners/:id/payments
 * @group Partner Payments - Operations related to partner payments
 * @param {string} id.path.required - The ID of the partner
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=50] - Number of items to return
 * @returns {ListPaymentsResponse} 200 - Paginated list of payments linked to the partner
 * @throws {MedusaError} 401 - Unauthorized - Missing or invalid authentication
 * @throws {MedusaError} 403 - Forbidden - Partner mismatch or insufficient permissions
 *
 * @example request
 * GET /partners/partner_123456789/payments?offset=0&limit=10
 *
 * @example response 200
 * {
 *   "payments": [
 *     {
 *       "id": "pay_123456789",
 *       "partner_id": "partner_123456789",
 *       "amount": "100.00",
 *       "currency": "USD",
 *       "status": "paid",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "pay_987654321",
 *       "partner_id": "partner_123456789",
 *       "amount": "75.50",
 *       "currency": "USD",
 *       "status": "pending",
 *       "created_at": "2023-01-02T00:00:00Z",
 *       "updated_at": "2023-01-02T00:00:00Z"
 *     }
 *   ],
 *   "count": 2,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { ListPaymentsByPartnerQuery } from "./validators"
import partnerPaymentsLink from "../../../../links/partner-payments-link"

// GET /api/partners/:id/payments - List all payments linked to a partner (self)
export const GET = async (
  req: AuthenticatedMedusaRequest<ListPaymentsByPartnerQuery>,
  res: MedusaResponse
) => {
  const { id: partner_id } = req.params

  // AuthZ: ensure the current admin belongs to this partner
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner || partner.id !== partner_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Forbidden: partner mismatch")
  }

  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentsByPartnerQuery>
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: partnerPaymentsLink.entryPoint,
    fields: ["internal_payments.*", "partner.*"],
    filters: { partner_id },
  })

  const all = (data || []).map((r: any) => r.internal_payments).filter(Boolean)
  const payments = all.slice(offset, offset + limit)
  return res.status(200).json({ payments, count: all.length, offset, limit })
}
