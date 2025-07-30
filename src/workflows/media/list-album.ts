import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import AlbumService from "../../modules/media/service";

export type ListAlbumStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listAlbumStep = createStep(
  "list-album-step",
  async (input: ListAlbumStepInput, { container }) => {
    const service: AlbumService = container.resolve(MEDIA_MODULE);
    const results = await service.listAndCountAlbums(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListAlbumWorkflowInput = ListAlbumStepInput;

export const listAlbumWorkflow = createWorkflow(
  "list-album",
  (input: ListAlbumWorkflowInput) => {
    const results = listAlbumStep(input);
    return new WorkflowResponse(results);
  }
);
