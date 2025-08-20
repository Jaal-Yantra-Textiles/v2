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
    },
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
