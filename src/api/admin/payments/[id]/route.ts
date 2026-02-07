/**
 * @file Admin API routes for managing payments
 * @description Provides endpoints for retrieving, updating, and deleting payments in the JYT Commerce platform
 * @module API/Admin/Payments
 */

/**
 * @typedef {Object} UpdatePaymentInput
 * @property {string} [status] - The status of the payment (e.g., "pending", "captured", "failed")
 * @property {string} [currency_code] - The currency code of the payment (e.g., "USD", "EUR")
 * @property {number} [amount] - The amount of the payment
 * @property {string} [provider_id] - The ID of the payment provider
 * @property {Object} [metadata] - Additional metadata for the payment
 * @property {string} [cart_id] - The ID of the cart associated with the payment
 * @property {string} [order_id] - The ID of the order associated with the payment
 */

/**
 * @typedef {Object} PaymentResponse
 * @property {string} id - The unique identifier of the payment
 * @property {string} status - The status of the payment
 * @property {string} currency_code - The currency code of the payment
 * @property {number} amount - The amount of the payment
 * @property {string} provider_id - The ID of the payment provider
 * @property {Object} metadata - Additional metadata for the payment
 * @property {string} cart_id - The ID of the cart associated with the payment
 * @property {string} order_id - The ID of the order associated with the payment
 * @property {Date} created_at - When the payment was created
 * @property {Date} updated_at - When the payment was last updated
 * @property {Date} deleted_at - When the payment was deleted (if applicable)
 */

/**
 * Retrieve a payment by ID
 * @route GET /admin/payments/:id
 * @group Payment - Operations related to payments
 * @param {string} id.path.required - The ID of the payment to retrieve
 * @returns {Object} 200 - The requested payment object
 * @throws {MedusaError} 400 - Invalid payment ID
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Payment not found
 *
 * @example request
 * GET /admin/payments/pay_123456789
 *
 * @example response 200
 * {
 *   "payment": {
 *     "id": "pay_123456789",
 *     "status": "captured",
 *     "currency_code": "USD",
 *     "amount": 10000,
 *     "provider_id": "stripe",
 *     "metadata": {},
 *     "cart_id": "cart_987654321",
 *     "order_id": "order_123456789",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "deleted_at": null
 *   }
 * }
 */

/**
 * Update a payment by ID
 * @route POST /admin/payments/:id
 * @group Payment - Operations related to payments
 * @param {string} id.path.required - The ID of the payment to update
 * @param {UpdatePaymentInput} request.body.required - Payment data to update
 * @returns {Object} 200 - The updated payment object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Payment not found
 *
 * @example request
 * POST /admin/payments/pay_123456789
 * {
 *   "status": "captured",
 *   "amount": 15000
 * }
 *
 * @example response 200
 * {
 *   "payment": {
 *     "id": "pay_123456789",
 *     "status": "captured",
 *     "currency_code": "USD",
 *     "amount": 15000,
 *     "provider_id": "stripe",
 *     "metadata": {},
 *     "cart_id": "cart_987654321",
 *     "order_id": "order_123456789",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "deleted_at": null
 *   }
 * }
 */

/**
 * Delete a payment by ID
 * @route DELETE /admin/payments/:id
 * @group Payment - Operations related to payments
 * @param {string} id.path.required - The ID of the payment to delete
 * @returns {Object} 200 - Confirmation of deletion
 * @throws {MedusaError} 400 - Invalid payment ID
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Payment not found
 *
 * @example request
 * DELETE /admin/payments/pay_123456789
 *
 * @example response 200
 * {
 *   "id": "pay_123456789",
 *   "object": "payment",
 *   "deleted": true
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdatePayment } from "../validators";
import { listPaymentWorkflow } from "../../../../workflows/internal_payments/list-payment";
import { updatePaymentWorkflow } from "../../../../workflows/internal_payments/update-payment";
import { deletePaymentWorkflow } from "../../../../workflows/internal_payments/delete-payment";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listPaymentWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ payment: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdatePayment>, res: MedusaResponse) => {
  const { result } = await updatePaymentWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  res.status(200).json({ payment: result });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deletePaymentWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "payment",
    deleted: true,
  });
};
