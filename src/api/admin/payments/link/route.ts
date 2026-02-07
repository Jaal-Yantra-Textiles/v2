/**
 * @file Admin API route for creating payment links
 * @description Provides endpoints for creating payment links in the JYT Commerce platform
 * @module API/Admin/Payments
 */

/**
 * @typedef {Object} CreatePaymentAndLinkInput
 * @property {string} amount - The amount to be paid
 * @property {string} currency_code - The currency code for the payment
 * @property {string} customer_id - The ID of the customer associated with the payment
 * @property {string} [description] - Optional description for the payment
 * @property {string} [metadata] - Optional metadata associated with the payment
 * @property {string} [resource_id] - Optional resource ID associated with the payment
 * @property {string} [resource_type] - Optional resource type associated with the payment
 */

/**
 * @typedef {Object} PaymentLinkResponse
 * @property {string} id - The unique identifier for the payment link
 * @property {string} amount - The amount to be paid
 * @property {string} currency_code - The currency code for the payment
 * @property {string} customer_id - The ID of the customer associated with the payment
 * @property {string} status - The status of the payment link
 * @property {string} [description] - Optional description for the payment
 * @property {string} [metadata] - Optional metadata associated with the payment
 * @property {string} [resource_id] - Optional resource ID associated with the payment
 * @property {string} [resource_type] - Optional resource type associated with the payment
 * @property {Date} created_at - When the payment link was created
 * @property {Date} updated_at - When the payment link was last updated
 */

/**
 * Create a payment link
 * @route POST /admin/payments/link
 * @group Payment - Operations related to payments
 * @param {CreatePaymentAndLinkInput} request.body.required - Payment link data to create
 * @returns {PaymentLinkResponse} 201 - Created payment link object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/payments/link
 * {
 *   "amount": 1000,
 *   "currency_code": "USD",
 *   "customer_id": "cust_123456789",
 *   "description": "Payment for order #12345",
 *   "metadata": {
 *     "order_id": "order_12345"
 *   },
 *   "resource_id": "order_12345",
 *   "resource_type": "order"
 * }
 *
 * @example response 201
 * {
 *   "id": "pay_link_123456789",
 *   "amount": 1000,
 *   "currency_code": "USD",
 *   "customer_id": "cust_123456789",
 *   "status": "pending",
 *   "description": "Payment for order #12345",
 *   "metadata": {
 *     "order_id": "order_12345"
 *   },
 *   "resource_id": "order_12345",
 *   "resource_type": "order",
 *   "created_at": "2023-01-01T00:00:00Z",
 *   "updated_at": "2023-01-01T00:00:00Z"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createPaymentAndLinkWorkflow } from "../../../../workflows/internal_payments/create-payment-and-link"
import { CreatePaymentAndLink } from "./validators"

export const POST = async (req: MedusaRequest<CreatePaymentAndLink>, res: MedusaResponse) => {
  const { result } = await createPaymentAndLinkWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  return res.status(201).json(result)
}
