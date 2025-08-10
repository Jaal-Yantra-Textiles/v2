import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "zod";
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders";
import InventoryOrderService from "../../../../../modules/inventory_orders/service";
import { refetchPartnerForThisAdmin } from "../../../helpers";
import { setInventoryOrderStepSuccessWorkflow } from "../../../../../workflows/inventory_orders/inventory-order-steps";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";
import { partnerCompleteInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/partner-complete-inventory-order";
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { TASKS_MODULE } from "../../../../../modules/tasks";
import TaskService from "../../../../../modules/tasks/service";

// Accept both snake_case and camelCase for backward compatibility, then normalize
const requestBodySchema = z.object({
    notes: z.string().optional(),
    deliveryDate: z.string().optional(),
    delivery_date: z.string().optional(),
    trackingNumber: z.string().optional(),
    tracking_number: z.string().optional(),
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
    
    const { notes, deliveryDate, delivery_date, trackingNumber, tracking_number, lines } = validation.data;
    const normalizedDeliveryDate = deliveryDate || delivery_date;
    const normalizedTrackingNumber = trackingNumber || tracking_number;
    console.debug("[partners.complete] request:", {
        orderId,
        notes: !!notes,
        deliveryDate: normalizedDeliveryDate,
        trackingNumber: normalizedTrackingNumber,
        linesCount: Array.isArray(lines) ? lines.length : 0,
        sampleLine: Array.isArray(lines) && lines[0] ? lines[0] : null,
    })

        // Get the authenticated partner using the same pattern as details route
        const adminId = req.auth_context.actor_id;
        const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope);
        
        if (!partnerAdmin) {
            return res.status(401).json({
                error: "Partner authentication required"
            });
        }
        // Delegate to workflow which validates, updates, completes tasks, and signals conditionally
        console.time(`[partners.complete] workflow.run ${orderId}`)
        const { result, errors } = await partnerCompleteInventoryOrderWorkflow(req.scope).run({
            input: {
                orderId,
                notes,
                deliveryDate: normalizedDeliveryDate,
                trackingNumber: normalizedTrackingNumber,
                lines
            }
        })
        console.timeEnd(`[partners.complete] workflow.run ${orderId}`)
        console.debug("[partners.complete] workflow result:", {
            hasResult: !!result,
            fullyFulfilled: result?.fullyFulfilled,
            shortagesCount: Array.isArray((result as any)?.shortages) ? (result as any).shortages.length : undefined,
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
