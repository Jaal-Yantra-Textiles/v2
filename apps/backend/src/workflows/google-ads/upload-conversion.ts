import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { refreshGoogleTokenStep } from "../google/steps/refresh-google-token"
import {
  uploadGoogleAdsConversionStep,
  type UploadGoogleAdsConversionOutput,
} from "./steps/upload-google-ads-conversion-step"

export type UploadGoogleAdsConversionWorkflowInput = {
  platform_id: string
  conversion_id: string
}

export const uploadGoogleAdsConversionWorkflowId =
  "upload-google-ads-conversion-workflow"

export const uploadGoogleAdsConversionWorkflow = createWorkflow(
  uploadGoogleAdsConversionWorkflowId,
  function (input: WorkflowData<UploadGoogleAdsConversionWorkflowInput>) {
    const refreshed = refreshGoogleTokenStep({
      platform_id: input.platform_id,
      force: false,
    })

    const stepInput = transform(
      { input, refreshed },
      ({ input, refreshed }) => ({
        platform_id: input.platform_id,
        conversion_id: input.conversion_id,
        access_token: refreshed.access_token,
      })
    )

    const result = uploadGoogleAdsConversionStep(stepInput)
    return new WorkflowResponse<UploadGoogleAdsConversionOutput>(result)
  }
)
