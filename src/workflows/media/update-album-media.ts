import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import AlbumMediaService from "../../modules/media/service";

export type UpdateAlbumMediaStepInput = {
  id: string;
  // TODO: Define optional properties for updating a AlbumMedia from your model
  // Example: name?: string;
};

export const updateAlbumMediaStep = createStep(
  "update-album-media-step",
  async (input: UpdateAlbumMediaStepInput, { container }) => {
    const service: AlbumMediaService = container.resolve(MEDIA_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveAlbumMedia(id);

    const updated = await service.updateAlbumMedias({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: AlbumMediaService = container.resolve(MEDIA_MODULE);
    await service.updateAlbumMedias({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
  }
);

export type UpdateAlbumMediaWorkflowInput = UpdateAlbumMediaStepInput;

export const updateAlbumMediaWorkflow = createWorkflow(
  "update-album-media",
  (input: UpdateAlbumMediaWorkflowInput) => {
    const result = updateAlbumMediaStep(input);
    return new WorkflowResponse(result);
  }
);
