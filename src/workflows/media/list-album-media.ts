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
  };
};

export const listAlbumMediaStep = createStep(
  "list-album-media-step",
  async (input: ListAlbumMediaStepInput, { container }) => {
    const service: AlbumMediaService = container.resolve(MEDIA_MODULE);
    const results = await service.listAndCountAlbumMedias(
      input.filters,
      input.config
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
