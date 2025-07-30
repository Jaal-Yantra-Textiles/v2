import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import AlbumMediaService from "../../modules/media/service";

export type DeleteAlbumMediaStepInput = {
  id: string;
};

export const deleteAlbumMediaStep = createStep(
  "delete-album-media-step",
  async (input: DeleteAlbumMediaStepInput, { container }) => {
    const service: AlbumMediaService = container.resolve(MEDIA_MODULE);
    const original = await service.retrieveAlbumMedia(input.id);

    await service.deleteAlbumMedias(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: AlbumMediaService = container.resolve(MEDIA_MODULE);
    await service.createAlbumMedias(original);
  }
);

export type DeleteAlbumMediaWorkflowInput = DeleteAlbumMediaStepInput;

export const deleteAlbumMediaWorkflow = createWorkflow(
  "delete-album-media",
  (input: DeleteAlbumMediaWorkflowInput) => {
    const result = deleteAlbumMediaStep(input);
    return new WorkflowResponse(result);
  }
);
