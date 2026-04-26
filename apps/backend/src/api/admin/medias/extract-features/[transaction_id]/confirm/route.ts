/**
 * @file Admin API route for confirming textile product extraction
 * @description Confirms and starts the textile product extraction workflow
 * @module API/Admin/Medias/ExtractFeatures/Confirm
 */

/**
 * Confirm a textile extraction transaction
 * @route POST /admin/medias/extract-features/{transaction_id}/confirm
 * @group Media - Media management operations
 *
 * @param {string} transaction_id.path.required - The transaction ID from the initial extraction request
 * @returns {ConfirmResponse} 200 - Success confirmation
 * @throws {MedusaError} 400 - Invalid transaction ID
 * @throws {MedusaError} 404 - Transaction not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/medias/extract-features/txn_abc123def456/confirm
 *
 * @example response 200
 * {
 *   "success": true,
 *   "message": "Extraction confirmed. Processing started."
 * }
 *
 * @description
 * This endpoint confirms a pending textile extraction workflow and resumes processing.
 * After confirmation, the extraction runs in the background and sends a notification
 * when complete.
 *
 * The workflow will:
 * 1. Use AI vision models to analyze the textile image
 * 2. Extract product features (designer, fabric type, colors, etc.)
 * 3. Optionally persist results to media metadata
 * 4. Send notification on completion/failure
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { IWorkflowEngineService } from "@medusajs/framework/types";
import { Modules, TransactionHandlerType } from "@medusajs/framework/utils";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  textileExtractionWorkflowId,
  waitConfirmationTextileExtractionStepId,
} from "../../../../../../workflows/ai/textile-product-extraction";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const workflowEngineService: IWorkflowEngineService = req.scope.resolve(
      Modules.WORKFLOW_ENGINE
    );
    const transactionId = req.params.transaction_id;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required",
      });
    }

    // Resume the suspended workflow step
    await workflowEngineService.setStepSuccess({
      idempotencyKey: {
        action: TransactionHandlerType.INVOKE,
        transactionId,
        stepId: waitConfirmationTextileExtractionStepId,
        workflowId: textileExtractionWorkflowId,
      },
      stepResponse: new StepResponse(true),
    });

    return res.status(200).json({
      success: true,
      message: "Extraction confirmed. Processing started.",
      transaction_id: transactionId,
    });
  } catch (error) {
    console.error("[ExtractFeatures/Confirm] Error:", error);

    // Check if it's a "workflow not found" type error
    const errorMessage = (error as Error)?.message || "";
    if (
      errorMessage.includes("not found") ||
      errorMessage.includes("does not exist")
    ) {
      return res.status(404).json({
        success: false,
        message: `Transaction not found or already processed: ${req.params.transaction_id}`,
      });
    }

    return res.status(500).json({
      success: false,
      message: errorMessage || "Failed to confirm extraction",
    });
  }
};
