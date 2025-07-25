import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { refetchPartnerForThisAdmin } from "../helpers";
import { ListInventoryOrdersQuery } from "./validators";
import InventoryOrderPartnerLink from "../../../links/partner-inventory-order"


export async function GET(
    req: AuthenticatedMedusaRequest<ListInventoryOrdersQuery>,
    res: MedusaResponse
) {
   
    const { limit = 20, offset = 0, status } = req.validatedQuery;

        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        
        // Get the authenticated partner using the same pattern as details route
        const adminId = req.auth_context.actor_id;
        const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope);
        
        if (!partnerAdmin) {
            return res.status(401).json({
                error: "Partner authentication required"
            });
        }
        
        // Build filters for orders assigned to this partner
        // Note: Cannot filter on linked module properties (inventory_orders.status)
        // due to MedusaJS limitation - filters only work on link table columns
        const filters: any = {
            partner_id: partnerAdmin.id
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
                    assigned_partner_id: linkData.partner?.id || partnerAdmin.id,
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
}
