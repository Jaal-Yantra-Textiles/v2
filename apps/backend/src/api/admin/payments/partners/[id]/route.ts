/**
 * @file Admin API routes for managing payment partners
 * @description Provides endpoints for retrieving payment information linked to partners in the JYT Commerce platform
 * @module API/Admin/Payments/Partners
 */

/**
 * @typedef {Object} ListPaymentsByPartnerQuery
 * @property {number} [offset=0] - Pagination offset for the list of payments
 * @property {number} [limit=50] - Maximum number of payments to return
 */

/**
 * @typedef {Object} PaymentPartner
 * @property {string} id - The unique identifier of the partner
 * @property {string} name - The name of the partner
 * @property {string} [description] - Additional information about the partner
 * @property {Date} created_at - When the partner was created
 * @property {Date} updated_at - When the partner was last updated
 */

/**
 * @typedef {Object} InternalPayment
 * @property {string} id - The unique identifier of the payment
 * @property {string} partner_id - The ID of the associated partner
 * @property {string} order_id - The ID of the associated order
 * @property {string} amount - The payment amount
 * @property {string} currency - The payment currency code
 * @property {string} status - The payment status (e.g., "pending", "completed", "failed")
 * @property {Date} created_at - When the payment was created
 * @property {Date} updated_at - When the payment was last updated
 * @property {Object} [metadata] - Additional payment metadata
 */

/**
 * @typedef {Object} ListPaymentsByPartnerResponse
 * @property {InternalPayment[]} payments - Array of payment objects linked to the partner
 * @property {number} count - Total number of payments available for the partner
 * @property {number} offset - The current pagination offset
 * @property {number} limit - The current pagination limit
 */

/**
 * List all payments linked to a specific partner
 * @route GET /admin/payments/partners/:id
 * @group Payment Partners - Operations related to payment partners
 * @param {string} id.path.required - The ID of the partner to retrieve payments for
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=50] - Number of items to return
 * @returns {ListPaymentsByPartnerResponse} 200 - Paginated list of payments linked to the partner
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/payments/partners/partner_123456789?offset=0&limit=10
 *
 * @example response 200
 * {
 *   "payments": [
 *     {
 *       "id": "pay_987654321",
 *       "partner_id": "partner_123456789",
 *       "order_id": "order_1122334455",
 *       "amount": "100.00",
 *       "currency": "USD",
 *       "status": "completed",
 *       "created_at": "2023-01-15T10:30:00Z",
 *       "updated_at": "2023-01-15T10:35:00Z",
 *       "metadata": {
 *         "payment_method": "credit_card",
 *         "last4": "4242"
 *       }
 *     },
 *     {
 *       "id": "pay_555666777",
 *       "partner_id": "partner_123456789",
 *       "order_id": "order_6677889900",
 *       "amount": "75.50",
 *       "currency": "USD",
 *       "status": "pending",
 *       "created_at": "2023-01-20T14:15:00Z",
 *       "updated_at": "2023-01-20T14:15:00Z"
 *     }
 *   ],
 *   "count": 42,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PartnerPaymentsLink from "../../../../../links/partner-payments-link"
import { ListPaymentsByPartnerQuery } from "./validators"

// GET /admin/payments/partners/:id - List all payments linked to a partner
export const GET = async (req: MedusaRequest<ListPaymentsByPartnerQuery>, res: MedusaResponse) => {
  const { id: partner_id } = req.params
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentsByPartnerQuery>
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: PartnerPaymentsLink.entryPoint,
    fields: ["internal_payments.*", "partner.*"],
    filters: { partner_id },
  })

  const all = (data || []).map((r: any) => r.internal_payments).filter(Boolean)
  const payments = all.slice(offset, offset + limit)
  return res.status(200).json({ payments, count: all.length, offset, limit })
}
