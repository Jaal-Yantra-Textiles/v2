/**
 * Admin API: Send Inventory Order to Partner
 *
 * Endpoint
 * POST /admin/inventory-orders/:id/send-to-partner
 *
 * Description
 * Starts a workflow to send an inventory order to a partner. The request must be authenticated
 * as an admin. The workflow is started and the route returns immediately with the created
 * transaction id (workflow transaction).
 *
 * Request body (application/json) - matches SendInventoryOrderToPartnerInput:
 * {
 *   "partnerId": "string", // required - partner to send the order to
 *   "notes": "string"      // optional - additional instructions
 * }
 *
 * Examples
 *
 * curl
 * curl -X POST "http://localhost:9000/admin/inventory-orders/ior_123/send-to-partner" \
 *   -H "Authorization: Bearer {ADMIN_API_TOKEN}" \
 *   -H "Content-Type: application/json" \
 *   -d '{"partnerId":"partner_456","notes":"Please prioritize this run."}'
 *
 * Node (fetch)
 * await fetch("http://localhost:9000/admin/inventory-orders/ior_123/send-to-partner", {
 *   method: "POST",
 *   headers: {
 *     "Authorization": "Bearer {ADMIN_API_TOKEN}",
 *     "Content-Type": "application/json"
 *   },
 *   body: JSON.stringify({ partnerId: "partner_456", notes: "Please prioritize this run." })
 * })
 *
 * Success response (200)
 * {
 *   "message": "Inventory order sent to partner successfully",
 *   "inventoryOrderId": "ior_123",
 *   "partnerId": "partner_456",
 *   "transactionId": "txn_abc123"
 * }
 *
 * Common errors
 * - 400 Bad Request: invalid/missing partnerId or malformed body
 * - 401 Unauthorized: missing/invalid admin auth
 * - 404 Not Found: inventory order or partner not found
 * - 500 Internal Server Error: workflow start failure
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { RemoteQueryFunction } from "@medusajs/types";
import { sendInventoryOrderToPartnerWorkflow } from "../../../../../workflows/inventory_orders/send-to-partner";
import { SendInventoryOrderToPartnerInput } from "./validators";

const PARTNER_TASK_NAMES = ["partner-order-sent", "partner-order-received", "partner-order-shipped"]

export async function POST(
    req: AuthenticatedMedusaRequest<SendInventoryOrderToPartnerInput>,
    res: MedusaResponse
) {
    const inventoryOrderId = req.params.id;
    const { partnerId, notes } = req.validatedBody;

    // Idempotency pre-check: reject before starting the workflow if already assigned.
    // This is the first line of defence — fast and avoids spawning orphaned workflows.
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const { data: orders } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "tasks.*"],
        filters: { id: inventoryOrderId },
    })
    const tasks: any[] = (orders?.[0] as any)?.tasks ?? []
    const existingAssignment = tasks.find(
        (t) => PARTNER_TASK_NAMES.includes(t?.title) && t?.transaction_id
    )
    if (existingAssignment) {
        return res.status(409).json({
            error: "Inventory order is already assigned to a partner",
            message: `Active send-to-partner workflow found (transaction: ${existingAssignment.transaction_id}). Cancel the existing workflow before reassigning.`,
            transactionId: existingAssignment.transaction_id,
        })
    }

    // Start the workflow and return immediately (long-running async)
    const { transaction } = await sendInventoryOrderToPartnerWorkflow(req.scope).run({
        input: {
            inventoryOrderId,
            partnerId,
            notes
        }
    });

    res.status(200).json({
        message: "Inventory order sent to partner successfully",
        inventoryOrderId,
        partnerId,
        transactionId: transaction.transactionId
    });
}
