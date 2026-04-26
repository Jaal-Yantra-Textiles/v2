import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import AlbumMediaService from "../../modules/media/service";

export type ListAlbumMediaStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
    order?: Record<string, "ASC" | "DESC">;
  };
};

export const listAlbumMediaStep = createStep(
  "list-album-media-step",
  async (input: ListAlbumMediaStepInput, { container }) => {
    const service: AlbumMediaService = container.resolve(MEDIA_MODULE);
    const config = {
      ...(input.config || {}),
      order: input.config?.order ?? { sort_order: "ASC", created_at: "DESC" },
    };
    const results = await service.listAndCountAlbumMedias(
      input.filters,
      config as any
    );
    return new StepResponse(results);
  }
);

export type ListAlbumMediaWorkflowInput = ListAlbumMediaStepInput;

export const listAlbumMediaWorkflow = createWorkflow(
  "list-album-media",
  (input: ListAlbumMediaWorkflowInput) => {
    const results = listAlbumMediaStep(input);
    return new WorkflowResponse(results);
  }
);
