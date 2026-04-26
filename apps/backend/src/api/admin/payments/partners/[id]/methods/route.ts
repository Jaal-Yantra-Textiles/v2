/**
 * @file Admin API routes for managing partner payment methods
 * @description Provides endpoints for listing and creating payment methods linked to partners in the JYT Commerce platform
 * @module API/Admin/PaymentMethods
 */

/**
 * @typedef {Object} ListPaymentMethodsByPartnerQuery
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=50] - Number of items to return
 */

/**
 * @typedef {Object} CreatePaymentMethodForPartner
 * @property {string} name - The name of the payment method
 * @property {string} type - The type of payment method (e.g., credit_card, bank_transfer)
 * @property {Object} details - Additional details specific to the payment method type
 * @property {string} details.account_number - Account number for bank transfers
 * @property {string} details.routing_number - Routing number for bank transfers
 * @property {string} details.card_number - Card number for credit cards
 * @property {string} details.expiry_date - Expiry date for credit cards
 * @property {string} details.cvv - CVV for credit cards
 */

/**
 * @typedef {Object} PaymentMethodResponse
 * @property {string} id - The unique identifier of the payment method
 * @property {string} name - The name of the payment method
 * @property {string} type - The type of payment method
 * @property {Object} details - Additional details specific to the payment method type
 * @property {string} partner_id - The ID of the partner linked to this payment method
 * @property {Date} created_at - When the payment method was created
 * @property {Date} updated_at - When the payment method was last updated
 */

/**
 * List payment methods linked to a partner
 * @route GET /admin/payments/partners/:id/methods
 * @group PaymentMethods - Operations related to payment methods
 * @param {string} id.path.required - The ID of the partner
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=50] - Number of items to return
 * @returns {Object} 200 - Paginated list of payment methods linked to the partner
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 *
 * @example request
 * GET /admin/payments/partners/partner_123456789/methods?offset=0&limit=10
 *
 * @example response 200
 * {
 *   "paymentMethods": [
 *     {
 *       "id": "pm_123456789",
 *       "name": "Primary Bank Account",
 *       "type": "bank_transfer",
 *       "details": {
 *         "account_number": "123456789",
 *         "routing_number": "987654321"
 *       },
 *       "partner_id": "partner_123456789",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 1,
 *   "offset": 0,
 *   "limit": 10
 * }
 */

/**
 * Create a payment method and link it to the partner
 * @route POST /admin/payments/partners/:id/methods
 * @group PaymentMethods - Operations related to payment methods
 * @param {string} id.path.required - The ID of the partner
 * @param {CreatePaymentMethodForPartner} request.body.required - Payment method data to create
 * @returns {Object} 201 - Created payment method object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 *
 * @example request
 * POST /admin/payments/partners/partner_123456789/methods
 * {
 *   "name": "Primary Bank Account",
 *   "type": "bank_transfer",
 *   "details": {
 *     "account_number": "123456789",
 *     "routing_number": "987654321"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "paymentMethod": {
 *     "id": "pm_123456789",
 *     "name": "Primary Bank Account",
 *     "type": "bank_transfer",
 *     "details": {
 *       "account_number": "123456789",
 *       "routing_number": "987654321"
 *     },
 *     "partner_id": "partner_123456789",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PartnerPaymentMethodsLink from "../../../../../../links/partner-payment-methods-link"
import { ListPaymentMethodsByPartnerQuery, CreatePaymentMethodForPartner } from "./validators"
import { createPaymentMethodAndLinkWorkflow } from "../../../../../../workflows/payment_methods/create-payment-method-and-link"

// GET /admin/payments/partners/:id/methods - List payment methods linked to a partner
export const GET = async (
  req: MedusaRequest<ListPaymentMethodsByPartnerQuery>,
  res: MedusaResponse
) => {
  const { id: partner_id } = req.params
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentMethodsByPartnerQuery>

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: PartnerPaymentMethodsLink.entryPoint,
    fields: ["internal_payment_details.*", "partner.*"],
    filters: { partner_id },
  })

  const all = (data || [])
    .map((r: any) => r.internal_payment_details)
    .filter(Boolean)
  const paymentMethods = all.slice(offset, offset + limit)
  return res.status(200).json({ paymentMethods, count: all.length, offset, limit })
}

// POST /admin/payments/partners/:id/methods - Create a payment method and link it to the partner
export const POST = async (
  req: MedusaRequest<CreatePaymentMethodForPartner>,
  res: MedusaResponse
) => {
  const { id: partner_id } = req.params
  const body = req.validatedBody

  const { result, errors } = await createPaymentMethodAndLinkWorkflow(req.scope).run({
    input: {
      ...body,
      partner_id,
    },
  })

  if (errors.length > 0) {
    throw errors
  }

  return res.status(201).json({ paymentMethod: result })
}
