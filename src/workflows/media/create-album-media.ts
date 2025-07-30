import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import AlbumMediaService from "../../modules/media/service";

export type CreateAlbumMediaStepInput = {
  album_id: string;
  media_id: string;
  sort_order?: number;
  title?: string;
  description?: string;
};

export const createAlbumMediaStep = createStep(
  "create-album-media-step",
  async (input: CreateAlbumMediaStepInput, { container }) => {
    const service: AlbumMediaService = container.resolve(MEDIA_MODULE);
    const created = await service.createAlbumMedias(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: AlbumMediaService = container.resolve(MEDIA_MODULE);
    await service.softDeleteAlbumMedias(id);
  }
);

export type CreateAlbumMediaWorkflowInput = CreateAlbumMediaStepInput;

export const createAlbumMediaWorkflow = createWorkflow(
  "create-album-media",
  (input: CreateAlbumMediaWorkflowInput) => {
    const result = createAlbumMediaStep(input);
    return new WorkflowResponse(result);
  }
);
