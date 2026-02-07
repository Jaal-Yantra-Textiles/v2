/**
 * @file Partner API route for retrieving inventory order details
 * @description Provides endpoints for partners to view detailed information about specific inventory orders assigned to them
 * @module API/Partners/InventoryOrders
 */

/**
 * @typedef {Object} InventoryOrderLine
 * @property {string} id - The unique identifier for the order line
 * @property {string} inventory_item_id - The ID of the associated inventory item
 * @property {number} quantity - The quantity of items ordered
 * @property {number} price - The price per unit
 * @property {Object} metadata - Additional metadata for the order line
 * @property {Date} created_at - When the order line was created
 * @property {Date} updated_at - When the order line was last updated
 * @property {Date} deleted_at - When the order line was deleted (if applicable)
 * @property {Array<Object>} inventory_items - Array of inventory items associated with this line
 * @property {Array<Object>} line_fulfillments - Array of fulfillment records for this line
 */

/**
 * @typedef {Object} PartnerInfo
 * @property {string} assigned_partner_id - The ID of the assigned partner
 * @property {string} partner_name - The name of the partner
 * @property {string} partner_handle - The handle/identifier of the partner
 * @property {string} partner_status - The status of the partner's workflow (assigned, in_progress, completed)
 * @property {string} partner_started_at - When the partner started processing the order (ISO date)
 * @property {string} partner_completed_at - When the partner completed the order (ISO date)
 * @property {number} workflow_tasks_count - Number of workflow tasks associated with this order
 * @property {string} partner_notes - Additional notes from the partner
 * @property {string} delivery_date - Expected delivery date from partner
 * @property {string} tracking_number - Tracking number provided by partner
 */

/**
 * @typedef {Object} InventoryOrderResponse
 * @property {string} id - The unique identifier for the inventory order
 * @property {string} status - The current status of the order
 * @property {number} quantity - Total quantity of items in the order
 * @property {number} total_price - Total price of the order
 * @property {Date} expected_delivery_date - Expected delivery date
 * @property {Date} order_date - When the order was placed
 * @property {boolean} is_sample - Whether this is a sample order
 * @property {Object} shipping_address - Shipping address details
 * @property {Array<InventoryOrderLine>} order_lines - Array of order lines
 * @property {Array<Object>} stock_locations - Array of stock locations associated with the order
 * @property {PartnerInfo} partner_info - Information about the assigned partner and their workflow status
 * @property {string} admin_notes - Notes from administrators about the order
 * @property {Date} created_at - When the order was created
 * @property {Date} updated_at - When the order was last updated
 */

/**
 * Retrieve detailed information about a specific inventory order
 * @route GET /partners/inventory-orders/:orderId
 * @group InventoryOrders - Operations related to inventory orders for partners
 * @param {string} orderId.path.required - The ID of the inventory order to retrieve
 * @returns {Object} 200 - Detailed information about the inventory order
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 404 - Inventory order not found
 * @throws {MedusaError} 403 - Inventory order is not assigned to your partner account
 *
 * @example request
 * GET /partners/inventory-orders/invord_123456789
 *
 * @example response 200
 * {
 *   "inventoryOrder": {
 *     "id": "invord_123456789",
 *     "status": "pending",
 *     "quantity": 100,
 *     "total_price": 5000,
 *     "expected_delivery_date": "2023-12-15T00:00:00Z",
 *     "order_date": "2023-11-01T10:00:00Z",
 *     "is_sample": false,
 *     "shipping_address": {
 *       "address1": "123 Main St",
 *       "city": "New York",
 *       "country": "US",
 *       "postal_code": "10001"
 *     },
 *     "order_lines": [
 *       {
 *         "id": "invline_987654321",
 *         "inventory_item_id": "invitem_1122334455",
 *         "quantity": 50,
 *         "price": 50,
 *         "metadata": {
 *           "color": "blue",
 *           "size": "medium"
 *         },
 *         "created_at": "2023-11-01T10:00:00Z",
 *         "updated_at": "2023-11-02T09:00:00Z",
 *         "deleted_at": null,
 *         "inventory_items": [
 *           {
 *             "id": "invitem_1122334455",
 *             "sku": "SKU123",
 *             "raw_materials": [
 *               {
 *                 "id": "mat_5566778899",
 *                 "name": "Cotton Fabric"
 *               }
 *             ]
 *           }
 *         ],
 *         "line_fulfillments": [
 *           {
 *             "id": "fulfill_1122334455",
 *             "quantity": 50,
 *             "status": "pending"
 *           }
 *         ]
 *       }
 *     ],
 *     "stock_locations": [
 *       {
 *         "id": "stockloc_112233",
 *         "name": "Warehouse A"
 *       }
 *     ],
 *     "partner_info": {
 *       "assigned_partner_id": "partner_12345",
 *       "partner_name": "Acme Supplies",
 *       "partner_handle": "acme_supplies",
 *       "partner_status": "in_progress",
 *       "partner_started_at": "2023-11-05T08:00:00Z",
 *       "partner_completed_at": null,
 *       "workflow_tasks_count": 3,
 *       "partner_notes": "Processing on schedule",
 *       "delivery_date": "2023-12-10",
 *       "tracking_number": "TRACK123456789"
 *     },
 *     "admin_notes": "High priority order",
 *     "created_at": "2023-11-01T10:00:00Z",
 *     "updated_at": "2023-11-10T14:30:00Z"
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext } from "../../helpers";

export async function GET(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const { orderId } = req.params;
    
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    
    // Get the authenticated partner using the same pattern as details route
    if (!req.auth_context?.actor_id) {
        return res.status(401).json({
            error: "Partner authentication required"
        });
    }

    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
    if (!partner) {
        return res.status(401).json({
            error: "Partner authentication required"
        });
    }
    
    // Get the order with all related data including tasks using query.graph
    const { data: orders } = await query.graph({
        entity: "inventory_orders",
        fields: [
            "*", 
            "orderlines.*", 
            "stock_locations.*", 
            "partner.*",
            "tasks.*",
            "orderlines.inventory_items.*",
            "orderlines.inventory_items.raw_materials.*",
            "orderlines.line_fulfillments.*"
        ],
        filters: {
            id: orderId
        }
    });

    
    if (!orders || orders.length === 0) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${orderId} not found`)
    }
    
    const order = orders[0];
    // Check if this order is assigned to the authenticated partner
    const assignedPartner = order.partner;
    if (!assignedPartner || assignedPartner.id !== partner.id) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${orderId} is not assigned to your partner account`)
    }
    
    // Extract partner workflow status from tasks instead of metadata
    const partnerTasks = order.tasks || [];
    // Identify workflow tasks by title or template_name convention
    const workflowTasks = (partnerTasks || []).filter((task: any) => {
        if (!task) return false;
        const title = String(task.title || '').toLowerCase();
        const templateName = String(task.metadata?.template_name || '').toLowerCase();
        return title.startsWith('partner-order-') || templateName.startsWith('partner-order-');
    });
    
    // Determine partner status based on task completion
    let partnerStatus = 'assigned';
    let partnerStartedAt: string | null = null;
    let partnerCompletedAt: string | null = null;
    let adminNotes: string | null = null;
    if (workflowTasks.length > 0) {
        const getName = (t: any) => (String(t?.title || t?.metadata?.template_name || '')).toLowerCase();
        const sentTask = workflowTasks.find((t: any) => getName(t).includes('sent') && t.status === 'completed');
        const receivedTask = workflowTasks.find((t: any) => getName(t).includes('received') && t.status === 'completed');
        const shippedTask = workflowTasks.find((t: any) => getName(t).includes('shipped') && t.status === 'completed');
        
   
    if (order.metadata && order.metadata.assignment_notes) {
        adminNotes = String(order.metadata.assignment_notes);
    }
    
       
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
    
    // Format the response for partner view - now using task-based status
    const partnerOrderView = {
        id: order.id,
        status: order.status,
        quantity: order.quantity,
        total_price: order.total_price,
        expected_delivery_date: order.expected_delivery_date,
        order_date: order.order_date,
        is_sample: order.is_sample,
        shipping_address: order.shipping_address,
        order_lines: order.orderlines?.map((line: any) => ({
            id: line.id,
            inventory_item_id: line.inventory_item_id,
            quantity: line.quantity,
            price: line.price,
            metadata: line.metadata ?? null,
            created_at: line.created_at,
            updated_at: line.updated_at,
            deleted_at: line.deleted_at ?? null,
            // Normalize inventory_items to an array and pass through nested raw_materials
            inventory_items: (() => {
                const items = line.inventory_items;
                if (!items) return [] as any[];
                return Array.isArray(items) ? items : [items];
            })(),
            // Normalize line_fulfillments to an array
            line_fulfillments: (() => {
                const fulf = line.line_fulfillments;
                if (!fulf) return [] as any[];
                return Array.isArray(fulf) ? fulf : [fulf];
            })()
        })),
        stock_locations: order.stock_locations,
        partner_info: {
            assigned_partner_id: assignedPartner.id,
            partner_name: assignedPartner.name,
            partner_handle: assignedPartner.handle,
            partner_status: partnerStatus,
            partner_started_at: partnerStartedAt,
            partner_completed_at: partnerCompletedAt,
            workflow_tasks_count: workflowTasks.length,
            // Keep metadata fields for backward compatibility (can be removed later)
            partner_notes: order.metadata?.partner_completion_notes,
            delivery_date: order.metadata?.partner_delivery_date,
            tracking_number: order.metadata?.partner_tracking_number
        },
        admin_notes: adminNotes, // Now from task metadata instead of order metadata
        created_at: order.created_at,
        updated_at: order.updated_at
    };
    
    res.status(200).json({
        inventoryOrder: partnerOrderView
    });
}
