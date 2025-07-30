import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import MediaFileService from "../../modules/media/service";

export type ListMediaFileStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listMediaFileStep = createStep(
  "list-media-file-step",
  async (input: ListMediaFileStepInput, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    const results = await service.listAndCountMediaFiles(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListMediaFileWorkflowInput = ListMediaFileStepInput;

export const listMediaFileWorkflow = createWorkflow(
  "list-media-file",
  (input: ListMediaFileWorkflowInput) => {
    const results = listMediaFileStep(input);
    return new WorkflowResponse(results);
  }
);
