/**
 * @file Admin API routes for managing payment-person relationships
 * @description Provides endpoints for retrieving payments linked to specific persons in the JYT Commerce platform
 * @module API/Admin/Payments/Persons
 */

/**
 * @typedef {Object} ListPaymentsByPersonQuery
 * @property {number} [offset=0] - Pagination offset for the list of payments
 * @property {number} [limit=50] - Maximum number of payments to return in a single request
 */

/**
 * @typedef {Object} Payment
 * @property {string} id - The unique identifier for the payment
 * @property {string} person_id - The ID of the person associated with this payment
 * @property {string} amount - The payment amount in the smallest currency unit
 * @property {string} currency_code - The 3-letter ISO currency code
 * @property {string} status - The current status of the payment (e.g., "pending", "completed", "failed")
 * @property {string} provider_id - The ID of the payment provider used
 * @property {Date} created_at - When the payment was created
 * @property {Date} updated_at - When the payment was last updated
 * @property {Object} metadata - Additional payment metadata
 */

/**
 * @typedef {Object} ListPaymentsByPersonResponse
 * @property {Payment[]} payments - Array of payment objects linked to the specified person
 * @property {number} count - Total number of payments available for this person
 * @property {number} offset - The current pagination offset
 * @property {number} limit - The current pagination limit
 */

/**
 * List payments linked to a specific person
 * @route GET /admin/payments/persons/:id
 * @group Payment - Operations related to payments
 * @param {string} id.path.required - The ID of the person whose payments should be retrieved
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=50] - Number of items to return
 * @returns {ListPaymentsByPersonResponse} 200 - Paginated list of payments linked to the specified person
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/payments/persons/person_123456789?offset=0&limit=20
 *
 * @example response 200
 * {
 *   "payments": [
 *     {
 *       "id": "pay_123456789",
 *       "person_id": "person_123456789",
 *       "amount": "10000",
 *       "currency_code": "USD",
 *       "status": "completed",
 *       "provider_id": "stripe",
 *       "created_at": "2023-01-15T10:30:00Z",
 *       "updated_at": "2023-01-15T10:35:00Z",
 *       "metadata": {
 *         "order_id": "order_987654321",
 *         "payment_method": "credit_card"
 *       }
 *     },
 *     {
 *       "id": "pay_987654321",
 *       "person_id": "person_123456789",
 *       "amount": "5000",
 *       "currency_code": "USD",
 *       "status": "pending",
 *       "provider_id": "paypal",
 *       "created_at": "2023-01-20T14:15:00Z",
 *       "updated_at": "2023-01-20T14:15:00Z",
 *       "metadata": {
 *         "order_id": "order_123456789",
 *         "payment_method": "paypal"
 *       }
 *     }
 *   ],
 *   "count": 2,
 *   "offset": 0,
 *   "limit": 20
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PersonPaymentsLink from "../../../../../links/person-payments-link"
import { ListPaymentsByPersonQuery } from "./validators"

// GET /admin/payments/persons/:id - List all payments linked to a person
export const GET = async (req: MedusaRequest<ListPaymentsByPersonQuery>, res: MedusaResponse) => {
  const { id: person_id } = req.params
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentsByPersonQuery>
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: PersonPaymentsLink.entryPoint,
    fields: ["internal_payments.*", "person.*"],
    filters: { person_id },
  })

  const all = (data || []).map((r: any) => r.internal_payments).filter(Boolean)
  const payments = all.slice(offset, offset + limit)
  return res.status(200).json({ payments, count: all.length, offset, limit })
}
