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
import InventoryOrderPartnerLink from "../../../links/partner-inventory-order"


export async function GET(
    req: AuthenticatedMedusaRequest<ListInventoryOrdersQuery>,
    res: MedusaResponse
) {
    try {
        const { limit = 20, offset = 0, status } = req.validatedQuery;

        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        
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
        
        const partnerId = partner.id;
        
        // Build filters for orders assigned to this partner
        // Note: Cannot filter on linked module properties (inventory_orders.status)
        // due to MedusaJS limitation - filters only work on link table columns
        const filters: any = {
            partner_id: partnerId
        };
        
        // Status filtering will be done after query, not in filters
        
        // Use query.graph to get orders linked to this partner with associated tasks
        const { data: orders, metadata } = await query.graph({
            entity: InventoryOrderPartnerLink.entryPoint,
            fields: [
                "inventory_orders.*", 
                "inventory_orders.orderlines.*", 
                "inventory_orders.stock_locations.*",
                "inventory_orders.tasks.*",
                "partner.*", 
              ],
            filters,
            pagination: {
                skip: offset,
                take: limit
            }
        });
        
        // Apply status filtering at application level (cannot be done in query due to MedusaJS limitation)
        // This is a workaround for now, we shall look into a better solution in the future
        // @todo fix this
        let filteredOrders = orders;
        if (status) {
            filteredOrders = orders.filter((linkData: any) => 
                linkData.inventory_orders?.status === status
            );
        }
        
        // Format the response for partner view - now using task-based status
        const partnerOrders = filteredOrders.map((linkData: any) => {
            const order = linkData.inventory_orders;
            
            // Extract partner workflow status from tasks instead of metadata
            const partnerTasks = order.tasks || [];
            const workflowTasks = partnerTasks.filter((task: any) => 
                task && task.metadata?.workflow_type === 'partner_assignment'
            );
            
            // Determine partner status based on task completion
            let partnerStatus = 'assigned';
            let partnerStartedAt: string | null = null;
            let partnerCompletedAt: string | null = null;
            
            if (workflowTasks.length > 0) {
                const sentTask = workflowTasks.find((task: any) => 
                    task.title?.includes('sent') && task.status === 'completed'
                );
                const receivedTask = workflowTasks.find((task: any) => 
                    task.title?.includes('received') && task.status === 'completed'
                );
                const shippedTask = workflowTasks.find((task: any) => 
                    task.title?.includes('shipped') && task.status === 'completed'
                );
                
                if (shippedTask) {
                    partnerStatus = 'completed';
                    partnerCompletedAt = shippedTask.updated_at ? String(shippedTask.updated_at) : null;
                } else if (receivedTask) {
                    partnerStatus = 'in_progress';
                    partnerStartedAt = receivedTask.updated_at ? String(receivedTask.updated_at) : null;
                } else if (sentTask) {
                    partnerStatus = 'assigned';
                }
            }
            
            return {
                id: order.id,
                status: order.status,
                quantity: order.quantity,
                total_price: order.total_price,
                expected_delivery_date: order.expected_delivery_date,
                order_date: order.order_date,
                is_sample: order.is_sample,
                order_lines_count: order.orderlines?.length || 0,
                stock_location: order.stock_locations?.[0]?.name || 'Unknown',
                partner_info: {
                    assigned_partner_id: linkData.partner?.id || partnerId,
                    partner_status: partnerStatus,
                    partner_started_at: partnerStartedAt,
                    partner_completed_at: partnerCompletedAt,
                    workflow_tasks_count: workflowTasks.length
                },
                created_at: order.created_at,
                updated_at: order.updated_at
            };
        });
        
        res.status(200).json({
            inventory_orders: partnerOrders,
            count: filteredOrders.length,
            limit,
            offset
        });
    } catch (error) {
        console.error("[Inventory Orders] Error:", error);
        return res.status(500).json({
            error: "Failed to fetch inventory orders",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}
