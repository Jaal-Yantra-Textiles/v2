import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import AlbumService from "../../modules/media/service";

export type UpdateAlbumStepInput = {
  id: string;
  // TODO: Define optional properties for updating a Album from your model
  // Example: name?: string;
};

export const updateAlbumStep = createStep(
  "update-album-step",
  async (input: UpdateAlbumStepInput, { container }) => {
    const service: AlbumService = container.resolve(MEDIA_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveAlbum(id);

    const updated = await service.updateAlbums({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: AlbumService = container.resolve(MEDIA_MODULE);
    await service.updateAlbums({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
  }
);

export type UpdateAlbumWorkflowInput = UpdateAlbumStepInput;

export const updateAlbumWorkflow = createWorkflow(
  "update-album",
  (input: UpdateAlbumWorkflowInput) => {
    const result = updateAlbumStep(input);
    return new WorkflowResponse(result);
  }
);
