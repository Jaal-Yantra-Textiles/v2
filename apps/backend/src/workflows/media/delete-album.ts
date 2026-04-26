import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import AlbumService from "../../modules/media/service";

export type DeleteAlbumStepInput = {
  id: string;
};

export const deleteAlbumStep = createStep(
  "delete-album-step",
  async (input: DeleteAlbumStepInput, { container }) => {
    const service: AlbumService = container.resolve(MEDIA_MODULE);
    const original = await service.retrieveAlbum(input.id);

    await service.deleteAlbums(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: AlbumService = container.resolve(MEDIA_MODULE);
    await service.createAlbums(original);
  }
);

export type DeleteAlbumWorkflowInput = DeleteAlbumStepInput;

export const deleteAlbumWorkflow = createWorkflow(
  "delete-album",
  (input: DeleteAlbumWorkflowInput) => {
    const result = deleteAlbumStep(input);
    return new WorkflowResponse(result);
  }
);
