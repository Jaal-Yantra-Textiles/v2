import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import AlbumService from "../../modules/media/service";

export type CreateAlbumStepInput = {
  name: string;
  description?: string;
  slug: string;
  cover_media?: string;
  is_public?: boolean;
  sort_order?: number;
  type?: "gallery" | "portfolio" | "product" | "profile" | "general";
  metadata?: Record<string, any>;
};

export const createAlbumStep = createStep(
  "create-album-step",
  async (input: CreateAlbumStepInput, { container }) => {
    const service: AlbumService = container.resolve(MEDIA_MODULE);
    const created = await service.createAlbums(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: AlbumService = container.resolve(MEDIA_MODULE);
    await service.softDeleteAlbums(id);
  }
);

export type CreateAlbumWorkflowInput = CreateAlbumStepInput;

export const createAlbumWorkflow = createWorkflow(
  "create-album",
  (input: CreateAlbumWorkflowInput) => {
    const result = createAlbumStep(input);
    return new WorkflowResponse(result);
  }
);
