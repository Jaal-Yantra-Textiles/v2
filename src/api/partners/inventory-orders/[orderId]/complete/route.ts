import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "zod";
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
