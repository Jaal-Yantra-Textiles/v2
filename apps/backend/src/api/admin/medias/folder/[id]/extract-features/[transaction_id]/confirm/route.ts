/**
 * @file Admin API route for confirming folder-wide textile extraction
 * @description Confirms and starts the rate-limited folder extraction workflow
 * @module API/Admin/Medias/Folder/ExtractFeatures/Confirm
 */

/**
 * Confirm a folder-wide textile extraction transaction
 * @route POST /admin/medias/folder/{id}/extract-features/{transaction_id}/confirm
 * @group Media - Media management operations
 *
 * @param {string} transaction_id.path.required - The transaction ID from the initial request
 * @returns {ConfirmResponse} 200 - Success confirmation
 * @throws {MedusaError} 404 - Transaction not found
 *
 * @description
 * Resumes the suspended folder extraction workflow. After confirmation the
 * workflow processes every image in the folder sequentially in the background,
 * one photo per minute by default.
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { IWorkflowEngineService } from "@medusajs/framework/types";
import { Modules, TransactionHandlerType } from "@medusajs/framework/utils";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  textileFolderExtractionWorkflowId,
  waitConfirmationTextileFolderExtractionStepId,
} from "../../../../../../../../workflows/ai/textile-folder-extraction";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
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
        stepId: waitConfirmationTextileFolderExtractionStepId,
        workflowId: textileFolderExtractionWorkflowId,
      },
      stepResponse: new StepResponse(true),
    });

    return res.status(200).json({
      success: true,
      message: "Folder extraction confirmed. Processing started at 1 photo per minute.",
      transaction_id: transactionId,
    });
  } catch (error) {
    logger.error(`[FolderExtractFeatures/Confirm] Error: ${error}`, error);

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
      message: errorMessage || "Failed to confirm folder extraction",
    });
  }
};
