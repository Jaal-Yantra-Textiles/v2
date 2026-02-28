/**
 * @file Partner API route for completing inventory orders
 * @description Provides endpoints for partners to complete inventory orders in the JYT Commerce platform
 * @module API/Partner/InventoryOrders
 */

/**
 * @typedef {Object} InventoryOrderLine
 * @property {string} order_line_id - The ID of the order line being fulfilled
 * @property {number} quantity - The quantity being fulfilled (must be >= 0)
 */

/**
 * @typedef {Object} CompleteInventoryOrderRequest
 * @property {string} [notes] - Additional notes about the completion
 * @property {string} [deliveryDate] - The delivery date in ISO format (YYYY-MM-DD)
 * @property {string} [delivery_date] - Alternative field name for deliveryDate (backward compatibility)
 * @property {string} [trackingNumber] - The tracking number for the shipment
 * @property {string} [tracking_number] - Alternative field name for trackingNumber (backward compatibility)
 * @property {string} [stock_location_id] - The ID of the stock location
 * @property {string} [stockLocationId] - Alternative field name for stock_location_id (backward compatibility)
 * @property {InventoryOrderLine[]} lines - Array of order lines being fulfilled (must not be empty)
 */

/**
 * @typedef {Object} CompleteInventoryOrderResponse
 * @property {string} message - Success message indicating completion status
 * @property {Object} result - The result of the completion operation
 * @property {boolean} result.fullyFulfilled - Whether the order was fully fulfilled
 */

/**
 * Complete an inventory order
 * @route POST /partners/inventory-orders/:orderId/complete
 * @group InventoryOrder - Operations related to inventory orders
 * @param {string} orderId.path.required - The ID of the inventory order to complete
 * @param {CompleteInventoryOrderRequest} request.body.required - Inventory order completion data
 * @returns {CompleteInventoryOrderResponse} 200 - Inventory order completion result
 * @throws {MedusaError} 400 - Invalid request body
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 500 - Failed to complete inventory order
 *
 * @example request
 * POST /partners/inventory-orders/inv_order_123456789/complete
 * {
 *   "notes": "Partial delivery due to stock constraints",
 *   "deliveryDate": "2023-12-15",
 *   "trackingNumber": "TRK123456789",
 *   "stockLocationId": "stock_loc_987654321",
 *   "lines": [
 *     {
 *       "order_line_id": "order_line_111111111",
 *       "quantity": 5
 *     },
 *     {
 *       "order_line_id": "order_line_222222222",
 *       "quantity": 3
 *     }
 *   ]
 * }
 *
 * @example response 200
 * {
 *   "message": "Order completed successfully",
 *   "result": {
 *     "fullyFulfilled": true
 *   }
 * }
 *
 * @example response 200 (partial delivery)
 * {
 *   "message": "Order updated (partial delivery)",
 *   "result": {
 *     "fullyFulfilled": false
 *   }
 * }
 *
 * @example response 400
 * {
 *   "error": "Invalid request body",
 *   "details": [
 *     {
 *       "code": "invalid_type",
 *       "expected": "string",
 *       "received": "number",
 *       "path": ["deliveryDate"],
 *       "message": "Expected string, received number"
 *     }
 *   ]
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to complete inventory order",
 *   "details": [
 *     {
 *       "message": "Database operation failed",
 *       "code": "DB_ERROR"
 *     }
 *   ]
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "@medusajs/framework/zod";
import { getPartnerFromAuthContext } from "../../../helpers";
import { partnerCompleteInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/partner-complete-inventory-order";

// Accept both snake_case and camelCase for backward compatibility, then normalize
const requestBodySchema = z.object({
    notes: z.string().optional(),
    deliveryDate: z.string().optional(),
    delivery_date: z.string().optional(),
    trackingNumber: z.string().optional(),
    tracking_number: z.string().optional(),
    stock_location_id: z.string().optional(),
    stockLocationId: z.string().optional(),
    lines: z.array(z.object({
        order_line_id: z.string(),
        quantity: z.number().min(0)
    })).nonempty()
});

export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const orderId = req.params.orderId;
    
    // Validate request body
    const validation = requestBodySchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: validation.error.errors
        });
    }
    
    const { notes, deliveryDate, delivery_date, trackingNumber, tracking_number, stock_location_id, stockLocationId, lines } = validation.data;
    const normalizedDeliveryDate = deliveryDate || delivery_date;
    const normalizedTrackingNumber = trackingNumber || tracking_number;
    const normalizedStockLocationId = stock_location_id || stockLocationId;

        // Get the authenticated partner using the same pattern as details route
        if (!req.auth_context?.actor_id) {
            return res.status(401).json({
                error: "Partner authentication required"
            });
        }

        const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
        if (!partner) {
            return res.status(401).json({
                error: "Partner authentication required"
            });
        }
        // Delegate to workflow which validates, updates, completes tasks, and signals conditionally
        const { result, errors } = await partnerCompleteInventoryOrderWorkflow(req.scope).run({
            input: {
                orderId,
                notes,
                deliveryDate: normalizedDeliveryDate,
                trackingNumber: normalizedTrackingNumber,
                stock_location_id: normalizedStockLocationId,
                lines
            }
        })
        if (errors && errors.length > 0) {
            return res.status(500).json({
                error: "Failed to complete inventory order",
                details: errors
            })
        }
        return res.status(200).json({
            message: result?.fullyFulfilled ? "Order completed successfully" : "Order updated (partial delivery)",
            result
        })
        
}
