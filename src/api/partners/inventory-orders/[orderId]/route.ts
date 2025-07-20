import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { refetchPartnerForThisAdmin } from "../../helpers";

export async function GET(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const { orderId } = req.params;
    
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    
    // Get the authenticated partner using the same pattern as details route
    const adminId = req.auth_context.actor_id;
    const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope);
    
    if (!partnerAdmin) {
        return res.status(401).json({
            error: "Partner authentication required"
        });
    }
    
    // Get the order with all related data using query.graph
    const { data: orders } = await query.graph({
        entity: "inventory_orders",
        fields: ["*", "orderlines.*", "stock_locations.*", "partner.*"],
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
    if (!assignedPartner || assignedPartner.id !== partnerAdmin.id) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${orderId} is not assigned to your partner account`)
    }
    
    // Format the response for partner view
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
            metadata: line.metadata
        })),
        stock_locations: order.stock_locations,
        partner_info: {
            assigned_partner_id: assignedPartner.id,
            partner_name: assignedPartner.name,
            partner_handle: assignedPartner.handle,
            partner_status: order.metadata?.partner_status || 'assigned',
            partner_started_at: order.metadata?.partner_started_at,
            partner_completed_at: order.metadata?.partner_completed_at,
            partner_notes: order.metadata?.partner_completion_notes,
            delivery_date: order.metadata?.partner_delivery_date,
            tracking_number: order.metadata?.partner_tracking_number
        },
        admin_notes: order.metadata?.assignment_notes,
        created_at: order.created_at,
        updated_at: order.updated_at
    };
    
    res.status(200).json({
        inventoryOrder: partnerOrderView
    });
}
