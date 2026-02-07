/**
 * @file Admin API routes for managing payments
 * @description Provides endpoints for creating and listing payments in the JYT Commerce platform
 * @module API/Admin/Payments
 */

/**
 * @typedef {Object} PaymentInput
 * @property {string} amount - The amount of the payment
 * @property {string} currency_code - The currency code for the payment (e.g., USD, EUR)
 * @property {string} provider_id - The ID of the payment provider
 * @property {string} cart_id - The ID of the cart associated with the payment
 * @property {string} customer_id - The ID of the customer making the payment
 * @property {string} [metadata] - Additional metadata for the payment
 */

/**
 * @typedef {Object} PaymentResponse
 * @property {string} id - The unique identifier for the payment
 * @property {string} amount - The amount of the payment
 * @property {string} currency_code - The currency code for the payment
 * @property {string} provider_id - The ID of the payment provider
 * @property {string} cart_id - The ID of the cart associated with the payment
 * @property {string} customer_id - The ID of the customer making the payment
 * @property {string} status - The status of the payment (e.g., pending, completed, failed)
 * @property {Date} created_at - When the payment was created
 * @property {Date} updated_at - When the payment was last updated
 * @property {Object} [metadata] - Additional metadata for the payment
 */

/**
 * @typedef {Object} ListPaymentsQuery
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=50] - Number of items to return
 */

/**
 * Create a new payment
 * @route POST /admin/payments
 * @group Payment - Operations related to payments
 * @param {PaymentInput} request.body.required - Payment data to create
 * @returns {Object} 201 - Created payment object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * POST /admin/payments
 * {
 *   "amount": 10000,
 *   "currency_code": "USD",
 *   "provider_id": "stripe",
 *   "cart_id": "cart_123456789",
 *   "customer_id": "cust_987654321",
 *   "metadata": {
 *     "order_id": "order_123456789"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "payment": {
 *     "id": "pay_123456789",
 *     "amount": 10000,
 *     "currency_code": "USD",
 *     "provider_id": "stripe",
 *     "cart_id": "cart_123456789",
 *     "customer_id": "cust_987654321",
 *     "status": "pending",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "metadata": {
 *       "order_id": "order_123456789"
 *     }
 *   }
 * }
 */

/**
 * List payments with pagination
 * @route GET /admin/payments
 * @group Payment - Operations related to payments
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=50] - Number of items to return
 * @returns {Object} 200 - Paginated list of payments
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * GET /admin/payments?offset=0&limit=10
 *
 * @example response 200
 * {
 *   "payments": [
 *     {
 *       "id": "pay_123456789",
 *       "amount": 10000,
 *       "currency_code": "USD",
 *       "provider_id": "stripe",
 *       "cart_id": "cart_123456789",
 *       "customer_id": "cust_987654321",
 *       "status": "completed",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "metadata": {
 *         "order_id": "order_123456789"
 *       }
 *     },
 *     {
 *       "id": "pay_987654321",
 *       "amount": 20000,
 *       "currency_code": "EUR",
 *       "provider_id": "paypal",
 *       "cart_id": "cart_987654321",
 *       "customer_id": "cust_123456789",
 *       "status": "pending",
 *       "created_at": "2023-01-02T00:00:00Z",
 *       "updated_at": "2023-01-02T00:00:00Z",
 *       "metadata": {
 *         "order_id": "order_987654321"
 *       }
 *     }
 *   ],
 *   "count": 50,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Payment, ListPaymentsQuery } from "./validators";
import { createPaymentWorkflow } from "../../../workflows/internal_payments/create-payment";
import { listPaymentWorkflow } from "../../../workflows/internal_payments/list-payment";

export const GET = async (req: MedusaRequest<ListPaymentsQuery>, res: MedusaResponse) => {
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentsQuery>
  const { result } = await listPaymentWorkflow(req.scope).run({
    input: {
      filters: {},
      config: {
        skip: offset,
        take: limit,
      },
    },
  })
  return res.status(200).json({ payments: result[0], count: result[1], offset, limit })
};

export const POST = async (req: MedusaRequest<Payment>, res: MedusaResponse) => {
  const { result } = await createPaymentWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ payment: result });
};
