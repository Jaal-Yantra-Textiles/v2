import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import MediaFileService from "../../modules/media/service";

export type UpdateMediaFileStepInput = {
  id: string;
  // TODO: Define optional properties for updating a MediaFile from your model
  // Example: name?: string;
};

export const updateMediaFileStep = createStep(
  "update-media-file-step",
  async (input: UpdateMediaFileStepInput, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveMediaFile(id);

    const updated = await service.updateMediaFiles({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    await service.updateMediaFiles({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
  }
);

export type UpdateMediaFileWorkflowInput = UpdateMediaFileStepInput;

export const updateMediaFileWorkflow = createWorkflow(
  "update-media-file",
  (input: UpdateMediaFileWorkflowInput) => {
    const result = updateMediaFileStep(input);
    return new WorkflowResponse(result);
  }
);
