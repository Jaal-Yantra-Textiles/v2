/**
 * @file Admin API routes for managing payment methods linked to persons
 * @description Provides endpoints for listing and creating payment methods associated with persons in the JYT Commerce platform
 * @module API/Admin/Payments/Persons
 */

/**
 * @typedef {Object} ListPaymentMethodsByPersonQuery
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=50] - Number of items to return
 */

/**
 * @typedef {Object} CreatePaymentMethodForPerson
 * @property {string} type - The type of payment method (e.g., "card", "bank_account")
 * @property {string} [metadata] - Additional metadata for the payment method
 * @property {Object} [data] - Payment method specific data
 */

/**
 * @typedef {Object} PaymentMethodResponse
 * @property {string} id - The unique identifier for the payment method
 * @property {string} type - The type of payment method
 * @property {string} status - The status of the payment method
 * @property {Object} metadata - Additional metadata
 * @property {Date} created_at - When the payment method was created
 * @property {Date} updated_at - When the payment method was last updated
 */

/**
 * @typedef {Object} PaginatedPaymentMethodsResponse
 * @property {PaymentMethodResponse[]} paymentMethods - List of payment methods
 * @property {number} count - Total count of payment methods
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Current pagination limit
 */

/**
 * List payment methods linked to a person
 * @route GET /admin/payments/persons/:id/methods
 * @group Payment Methods - Operations related to payment methods
 * @param {string} id.path.required - The ID of the person
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=50] - Number of items to return
 * @returns {PaginatedPaymentMethodsResponse} 200 - Paginated list of payment methods linked to the person
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * GET /admin/payments/persons/pers_123456789/methods?offset=0&limit=10
 *
 * @example response 200
 * {
 *   "paymentMethods": [
 *     {
 *       "id": "pm_123456789",
 *       "type": "card",
 *       "status": "active",
 *       "metadata": {
 *         "brand": "Visa",
 *         "last4": "4242"
 *       },
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
 * Create a payment method and link it to the person
 * @route POST /admin/payments/persons/:id/methods
 * @group Payment Methods - Operations related to payment methods
 * @param {string} id.path.required - The ID of the person
 * @param {CreatePaymentMethodForPerson} request.body.required - Payment method data to create
 * @returns {Object} 201 - Created payment method object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * POST /admin/payments/persons/pers_123456789/methods
 * {
 *   "type": "card",
 *   "metadata": {
 *     "brand": "Visa",
 *     "last4": "4242"
 *   },
 *   "data": {
 *     "token": "tok_123456789"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "paymentMethod": {
 *     "id": "pm_123456789",
 *     "type": "card",
 *     "status": "active",
 *     "metadata": {
 *       "brand": "Visa",
 *       "last4": "4242"
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PersonPaymentMethodsLink from "../../../../../../links/person-payment-methods-link"
import { ListPaymentMethodsByPersonQuery, CreatePaymentMethodForPerson } from "./validators"
import { createPaymentMethodAndLinkWorkflow } from "../../../../../../workflows/payment_methods/create-payment-method-and-link"

// GET /admin/payments/persons/:id/methods - List payment methods linked to a person
export const GET = async (
  req: MedusaRequest<ListPaymentMethodsByPersonQuery>,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentMethodsByPersonQuery>

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: PersonPaymentMethodsLink.entryPoint,
    fields: ["internal_payment_details.*", 'person.*'],
    filters: { person_id },
  })
  const all = (data || [])
    .map((r: any) => r.internal_payment_details)
    .filter(Boolean)
  const paymentMethods = all.slice(offset, offset + limit)
  return res.status(200).json({ paymentMethods, count: all.length, offset, limit })
}

// POST /admin/payments/persons/:id/methods - Create a payment method and link it to the person
export const POST = async (
  req: MedusaRequest<CreatePaymentMethodForPerson>,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params
  const body = req.validatedBody

  const { result, errors } = await createPaymentMethodAndLinkWorkflow(req.scope).run({
    input: {
      ...body,
      person_id,
    },
  })

  if (errors.length > 0) {
    throw errors
  }

  return res.status(201).json({ paymentMethod: result })
}
