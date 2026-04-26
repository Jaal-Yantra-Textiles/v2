import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import MediaFileService from "../../modules/media/service";

export type DeleteMediaFileStepInput = {
  id: string;
};

export const deleteMediaFileStep = createStep(
  "delete-media-file-step",
  async (input: DeleteMediaFileStepInput, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    const original = await service.retrieveMediaFile(input.id);

    await service.deleteMediaFiles(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    await service.createMediaFiles(original);
  }
);

export type DeleteMediaFileWorkflowInput = DeleteMediaFileStepInput;

export const deleteMediaFileWorkflow = createWorkflow(
  "delete-media-file",
  (input: DeleteMediaFileWorkflowInput) => {
    const result = deleteMediaFileStep(input);
    return new WorkflowResponse(result);
  }
);
