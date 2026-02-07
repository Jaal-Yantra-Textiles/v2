/**
 * @file Partner Payment Methods API routes
 * @description Provides endpoints for managing payment methods linked to partners in the JYT Commerce platform
 * @module API/Partners/PaymentMethods
 */

/**
 * @typedef {Object} ListPaymentMethodsByPartnerQuery
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=50] - Number of items to return
 */

/**
 * @typedef {Object} CreatePaymentMethodForPartner
 * @property {string} type - The type of payment method (e.g., "card", "bank_account")
 * @property {Object} details - Payment method details
 * @property {string} details.card_number - Card number (if type is "card")
 * @property {string} details.expiry_month - Expiry month (if type is "card")
 * @property {string} details.expiry_year - Expiry year (if type is "card")
 * @property {string} details.cvv - CVV code (if type is "card")
 * @property {string} details.bank_name - Bank name (if type is "bank_account")
 * @property {string} details.account_number - Account number (if type is "bank_account")
 * @property {string} details.routing_number - Routing number (if type is "bank_account")
 */

/**
 * @typedef {Object} PaymentMethodResponse
 * @property {string} id - The unique identifier of the payment method
 * @property {string} type - The type of payment method
 * @property {Object} details - Payment method details
 * @property {string} partner_id - The ID of the partner linked to this payment method
 * @property {Date} created_at - When the payment method was created
 * @property {Date} updated_at - When the payment method was last updated
 */

/**
 * List payment methods linked to a partner
 * @route GET /partners/:id/payments/methods
 * @group Partner Payment Methods - Operations related to partner payment methods
 * @param {string} id.path.required - The ID of the partner
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=50] - Number of items to return
 * @returns {Object} 200 - Paginated list of payment methods linked to the partner
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 403 - Forbidden: partner mismatch
 *
 * @example request
 * GET /partners/partner_123456789/payments/methods?offset=0&limit=10
 *
 * @example response 200
 * {
 *   "paymentMethods": [
 *     {
 *       "id": "pm_123456789",
 *       "type": "card",
 *       "details": {
 *         "card_number": "**** **** **** 1234",
 *         "expiry_month": "12",
 *         "expiry_year": "2025"
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
 * Create a payment method and link it to a partner
 * @route POST /partners/:id/payments/methods
 * @group Partner Payment Methods - Operations related to partner payment methods
 * @param {string} id.path.required - The ID of the partner
 * @param {CreatePaymentMethodForPartner} request.body.required - Payment method data to create
 * @returns {Object} 201 - Created payment method object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 403 - Forbidden: partner mismatch
 *
 * @example request
 * POST /partners/partner_123456789/payments/methods
 * {
 *   "type": "card",
 *   "details": {
 *     "card_number": "4242424242424242",
 *     "expiry_month": "12",
 *     "expiry_year": "2025",
 *     "cvv": "123"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "paymentMethod": {
 *     "id": "pm_987654321",
 *     "type": "card",
 *     "details": {
 *       "card_number": "**** **** **** 4242",
 *       "expiry_month": "12",
 *       "expiry_year": "2025"
 *     },
 *     "partner_id": "partner_123456789",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import PartnerPaymentMethodsLink from "../../../../../links/partner-payment-methods-link"
import {
  ListPaymentMethodsByPartnerQuery,
  CreatePaymentMethodForPartner,
} from "../validators"
import { createPaymentMethodAndLinkWorkflow } from "../../../../../workflows/payment_methods/create-payment-method-and-link"
import { getPartnerFromAuthContext } from "../../../helpers"

// GET /api/partners/:id/payments/methods - List payment methods linked to a partner (self)
export const GET = async (
  req: AuthenticatedMedusaRequest<ListPaymentMethodsByPartnerQuery>,
  res: MedusaResponse
) => {
  const { id: partner_id } = req.params

  // AuthZ: ensure the current user is authenticated as this partner
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner || partner.id !== partner_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Forbidden: partner mismatch")
  }

  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentMethodsByPartnerQuery>

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: PartnerPaymentMethodsLink.entryPoint,
    fields: ["internal_payment_details.*", "partner.*"],
    filters: { partner_id },
  })

  const all = (data || []).map((r: any) => r.internal_payment_details).filter(Boolean)
  const paymentMethods = all.slice(offset, offset + limit)
  return res.status(200).json({ paymentMethods, count: all.length, offset, limit })
}

// POST /api/partners/:id/payments/methods - Create a payment method and link it to the partner (self)
export const POST = async (
  req: AuthenticatedMedusaRequest<CreatePaymentMethodForPartner>,
  res: MedusaResponse
) => {
  const { id: partner_id } = req.params

  // AuthZ: ensure the current user is authenticated as this partner
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner || partner.id !== partner_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Forbidden: partner mismatch")
  }

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
