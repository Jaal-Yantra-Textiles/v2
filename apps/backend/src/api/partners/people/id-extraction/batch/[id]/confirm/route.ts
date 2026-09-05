import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  idExtractionBatchWorkflowId,
  waitConfirmationIdExtractionBatchStepId,
} from "../../../../../../../workflows/ai/id-extraction-batch"
import { getPartnerFromAuthContext } from "../../../../../helpers"
import { PERSON_MODULE } from "../../../../../../../modules/person"

/**
 * POST /partners/people/id-extraction/batch/:id/confirm
 *
 * Starts the read. From here the photographs go one at a time in the
 * background and the caller's request does not wait — the whole reason this
 * shape exists rather than ten synchronous calls behind a 100s edge limit.
 *
 * Addressed by `batch_id`; the transaction lives on the row.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner is associated with this session."
    )
  }

  const service: any = req.scope.resolve(PERSON_MODULE)
  const batch = await service
    .retrieveIdExtractionBatch(req.params.id)
    .catch(() => null)

  // Another partner's batch reads as absent, never as forbidden.
  if (!batch || batch.partner_id !== partner.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No such batch: ${req.params.id}`
    )
  }

  if (!batch.transaction_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This batch has no workflow transaction recorded, so it cannot be confirmed. Create a new batch."
    )
  }

  /**
   * Confirming an already-running batch is a double-click, not an error. Say so
   * and change nothing rather than throwing at someone who pressed twice.
   */
  if (batch.status !== "pending_confirmation") {
    return res.status(200).json({
      success: true,
      already: true,
      message: `Batch is already ${batch.status}.`,
      batch_id: batch.id,
    })
  }

  try {
    const engine: IWorkflowEngineService = req.scope.resolve(
      Modules.WORKFLOW_ENGINE
    )

    await engine.setStepSuccess({
      idempotencyKey: {
        action: TransactionHandlerType.INVOKE,
        transactionId: batch.transaction_id,
        stepId: waitConfirmationIdExtractionBatchStepId,
        workflowId: idExtractionBatchWorkflowId,
      },
      stepResponse: new StepResponse(true),
    })

    return res.status(200).json({
      success: true,
      message:
        "Batch confirmed. Photographs are read one at a time in the background; poll the batch for drafts.",
      batch_id: batch.id,
      transaction_id: batch.transaction_id,
    })
  } catch (error) {
    logger?.error?.(`[IdExtractionBatch/Confirm] ${error}`, error)
    const message = (error as Error)?.message ?? ""

    if (message.includes("not found") || message.includes("does not exist")) {
      return res.status(404).json({
        success: false,
        message: `Transaction not found or already confirmed: ${batch.transaction_id}`,
      })
    }

    return res
      .status(500)
      .json({ success: false, message: message || "Failed to confirm the batch" })
  }
}
