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
    
    // Get the order with all related data including tasks using query.graph
    const { data: orders } = await query.graph({
        entity: "inventory_orders",
        fields: [
            "*", 
            "orderlines.*", 
            "stock_locations.*", 
            "partner.*",
            "tasks.*"
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
    if (!assignedPartner || assignedPartner.id !== partnerAdmin.id) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${orderId} is not assigned to your partner account`)
    }
    
    // Extract partner workflow status from tasks instead of metadata
    const partnerTasks = order.tasks || [];
    const workflowTasks = partnerTasks.filter((task: any) => 
        task && task.metadata?.workflow_type === 'partner_assignment'
    );
    
    // Determine partner status based on task completion
    let partnerStatus = 'assigned';
    let partnerStartedAt: string | null = null;
    let partnerCompletedAt: string | null = null;
    let adminNotes: string | null = null;
    
    if (workflowTasks.length > 0) {
        console.log("Workflow tasks:", JSON.stringify(workflowTasks, null, 2));
        const sentTask = workflowTasks.find((task: any) => 
            task.title?.includes('sent') && task.status === 'completed'
        );
        const receivedTask = workflowTasks.find((task: any) => 
            task.title?.includes('received') && task.status === 'completed'
        );
        const shippedTask = workflowTasks.find((task: any) => 
            task.title?.includes('shipped') && task.status === 'completed'
        );
        
   
    if (order.metadata && order.metadata.assignment_notes) {
        adminNotes = String(order.metadata.assignment_notes);
        console.log("Found admin notes in order metadata:", adminNotes);
    } else {
        console.log("No assignment_notes found in order metadata");
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
            metadata: line.metadata
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
    
    console.log("Final partnerOrderView structure:", JSON.stringify({
        admin_notes: partnerOrderView.admin_notes,
        partner_info: partnerOrderView.partner_info
    }, null, 2));
    
    res.status(200).json({
        inventoryOrder: partnerOrderView
    });
}
