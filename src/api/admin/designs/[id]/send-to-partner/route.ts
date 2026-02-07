
/**
 * POST /admin/designs/:id/send-to-partner
 *
 * Initiates a "send design to partner" workflow for the specified design.
 * Creates an asynchronous workflow transaction (returned in the response)
 * that will manage sending the design, notifying the partner, and any
 * follow-up steps. The workflow is started within the request scope and a
 * transaction object is returned immediately; downstream processing may
 * continue after this endpoint responds.
 *
 * Authentication: Requires a valid admin bearer token in the Authorization header.
 *
 * Request:
 * - Path param: id (string) — the design id to send
 * - JSON body (SendDesignToPartnerInput):
 *   - partnerId: string (required) — target partner identifier
 *   - notes?: string (optional) — optional notes to include with the send
 *
 * Response (200):
 * {
 *   message: string,
 *   designId: string,
 *   partnerId: string,
 *   transactionId: string
 * }
 *
 * Side effects:
 * - Starts the sendDesignToPartnerWorkflow with enableRedo: true.
 * - A workflow transaction record is created and its id is returned as transactionId.
 * - The workflow may perform notifications and partner API calls; these occur
 *   inside the workflow and are not awaited by this endpoint.
 *
 * Errors:
 * - 4xx if authentication fails, the design or partner is not found, or request validation fails.
 * - 5xx for unexpected server / workflow initialization errors.
 *
 * Examples:
 *
 * curl:
 *   curl -X POST "https://api.example.com/admin/designs/design_123/send-to-partner" \
 *     -H "Authorization: Bearer ADMIN_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"partnerId":"partner_abc","notes":"Please prioritize this design."}'
 *
 * fetch (browser / node):
 *   await fetch('/admin/designs/design_123/send-to-partner', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'Authorization': 'Bearer ADMIN_TOKEN'
 *     },
 *     body: JSON.stringify({ partnerId: 'partner_abc', notes: 'Please prioritize.' })
 *   }).then(res => res.json())
 *
 * TypeScript (SDK-style):
 *   const response = await api.post(`/admin/designs/${designId}/send-to-partner`, {
 *     partnerId: 'partner_abc',
 *     notes: 'Optional notes'
 *   })
 *   // response => { message, designId, partnerId, transactionId }
 *
 * @param req - AuthenticatedMedusaRequest<SendDesignToPartnerInput> containing:
 *   - req.params.id: string (design id)
 *   - req.validatedBody.partnerId: string
 *   - req.validatedBody.notes?: string
 * @param res - MedusaResponse used to send the JSON response (200 on success)
 * @returns JSON object with message, designId, partnerId and transactionId
 * @throws Throws on validation errors or if workflow initialization fails.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { sendDesignToPartnerWorkflow } from "../../../../../workflows/designs/send-to-partner"
import { SendDesignToPartnerInput } from "./validators"

export async function POST(
  req: AuthenticatedMedusaRequest<SendDesignToPartnerInput>,
  res: MedusaResponse
) {
  const designId = req.params.id
  const { partnerId, notes } = req.validatedBody

  // Start the workflow (don't await completion)
  const { transaction } = await sendDesignToPartnerWorkflow(req.scope).run({
    input: {
      designId,
      partnerId,
      notes,
      enableRedo: true,
    },
    throwOnError: true,
  })

  // Build object for potential step payloads (kept for future use if needed)
  const postTransactionObj = {
    id: designId,
    transaction_id: transaction.transactionId,
    metadata: {
      partner_workflow_transaction_id: transaction.transactionId,
    },
  }

  // No external signaling here. The notify step runs synchronously inside the workflow.

  res.status(200).json({
    message: "Design sent to partner successfully",
    designId,
    partnerId,
    transactionId: transaction.transactionId,
  })
}
