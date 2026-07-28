/**
 * @file Partner API routes for inventory orders
 * @description Provides endpoints for partners to retrieve and manage inventory orders in the JYT Commerce platform
 * @module API/Partners/InventoryOrders
 */

/**
 * @typedef {Object} ListInventoryOrdersQuery
 * @property {number} [limit=20] - Number of items to return (default: 20)
 * @property {number} [offset=0] - Pagination offset (default: 0)
 * @property {string} [status] - Filter by inventory order status
 */

/**
 * @typedef {Object} InventoryOrderLine
 * @property {string} id - The unique identifier for the order line
 * @property {string} product_id - The product ID
 * @property {number} quantity - The quantity ordered
 * @property {number} price - The price per unit
 */

/**
 * @typedef {Object} StockLocation
 * @property {string} id - The unique identifier for the stock location
 * @property {string} name - The name of the stock location
 * @property {string} address - The address of the stock location
 */

/**
 * @typedef {Object} Task
 * @property {string} id - The unique identifier for the task
 * @property {string} title - The title of the task
 * @property {string} status - The status of the task (pending, completed, etc.)
 * @property {Date} created_at - When the task was created
 * @property {Date} updated_at - When the task was last updated
 * @property {Object} metadata - Additional task metadata
 * @property {string} metadata.workflow_type - The type of workflow (e.g., partner_assignment)
 */

/**
 * @typedef {Object} PartnerInfo
 * @property {string} assigned_partner_id - The ID of the assigned partner
 * @property {string} partner_status - The status of the partner's workflow (assigned, in_progress, completed)
 * @property {string|null} partner_started_at - When the partner started the workflow (ISO timestamp)
 * @property {string|null} partner_completed_at - When the partner completed the workflow (ISO timestamp)
 * @property {number} workflow_tasks_count - The number of workflow tasks
 */

/**
 * @typedef {Object} InventoryOrderResponse
 * @property {string} id - The unique identifier for the inventory order
 * @property {string} status - The status of the inventory order
 * @property {number} quantity - The total quantity of items in the order
 * @property {number} total_price - The total price of the order
 * @property {string} expected_delivery_date - The expected delivery date (ISO timestamp)
 * @property {string} order_date - The date the order was placed (ISO timestamp)
 * @property {boolean} is_sample - Whether the order is a sample
 * @property {number} order_lines_count - The number of order lines
 * @property {string} stock_location - The name of the stock location
 * @property {PartnerInfo} partner_info - Information about the partner's workflow status
 * @property {Date} created_at - When the inventory order was created
 * @property {Date} updated_at - When the inventory order was last updated
 */

/**
 * @typedef {Object} InventoryOrdersListResponse
 * @property {InventoryOrderResponse[]} inventory_orders - List of inventory orders
 * @property {number} count - Total number of inventory orders returned
 * @property {number} limit - The limit used for pagination
 * @property {number} offset - The offset used for pagination
 */

/**
 * List inventory orders assigned to the authenticated partner
 * @route GET /partners/inventory-orders
 * @group InventoryOrders - Operations related to inventory orders for partners
 * @param {number} [offset=0] - Pagination offset (default: 0)
 * @param {number} [limit=20] - Number of items to return (default: 20)
 * @param {string} [status] - Filter by inventory order status
 * @returns {InventoryOrdersListResponse} 200 - Paginated list of inventory orders assigned to the partner
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required
 * @throws {MedusaError} 500 - Failed to fetch inventory orders
 *
 * @example request
 * GET /partners/inventory-orders?offset=0&limit=10&status=pending
 *
 * @example response 200
 * {
 *   "inventory_orders": [
 *     {
 *       "id": "inv_order_123456789",
 *       "status": "pending",
 *       "quantity": 50,
 *       "total_price": 1000,
 *       "expected_delivery_date": "2023-12-31T00:00:00Z",
 *       "order_date": "2023-10-01T00:00:00Z",
 *       "is_sample": false,
 *       "order_lines_count": 5,
 *       "stock_location": "Warehouse A",
 *       "partner_info": {
 *         "assigned_partner_id": "partner_987654321",
 *         "partner_status": "assigned",
 *         "partner_started_at": null,
 *         "partner_completed_at": null,
 *         "workflow_tasks_count": 1
 *       },
 *       "created_at": "2023-10-01T00:00:00Z",
 *       "updated_at": "2023-10-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 1,
 *   "limit": 10,
 *   "offset": 0
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required - no actor ID"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to fetch inventory orders",
 *   "details": "Internal server error"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext } from "../helpers";
import { ListInventoryOrdersQuery } from "./validators";
import { listPartnerInventoryOrdersWorkflow } from "../../../workflows/inventory_orders/list-partner-inventory-orders"


export async function GET(
    req: AuthenticatedMedusaRequest<ListInventoryOrdersQuery>,
    res: MedusaResponse
) {
    try {
        const { limit = 20, offset = 0, status, q } =
            req.validatedQuery as ListInventoryOrdersQuery;

        // Get the authenticated partner from auth context
        const actorId = req.auth_context?.actor_id;
        
        if (!actorId) {
            return res.status(401).json({
                error: "Partner authentication required - no actor ID"
            });
        }

        const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
        
        if (!partner) {
            return res.status(401).json({
                error: "Partner authentication required - no partner found"
            });
        }
        
        // Auth is all this route contributes — the listing (partner_info
        // derivation, q/status filtering, pagination) belongs to the workflow so
        // the admin inspection mirror runs the same code rather than a second
        // copy of it (#843).
        const { result } = await listPartnerInventoryOrdersWorkflow(req.scope).run({
            input: {
                partnerId: partner.id,
                q,
                status,
                offset,
                limit,
                locale: req.locale,
            },
        });

        res.status(200).json(result);
    } catch (error) {
        const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
        logger.error(
            "[partner inventory-orders] list failed",
            error instanceof Error ? error : new Error(String(error))
        )
        // #778 H10 — don't leak internal error details to the client; let the
        // framework error handler produce a sanitized response (MedusaError
        // types still map to the right 4xx).
        throw error
    }
}
