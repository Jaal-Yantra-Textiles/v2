import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import FolderService from "../../modules/media/service";

export type ListFolderStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listFolderStep = createStep(
  "list-folder-step",
  async (input: ListFolderStepInput, { container }) => {
    const service: FolderService = container.resolve(MEDIA_MODULE);
    const results = await service.listAndCountFolders(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListFolderWorkflowInput = ListFolderStepInput;

export const listFolderWorkflow = createWorkflow(
  "list-folder",
  (input: ListFolderWorkflowInput) => {
    const results = listFolderStep(input);
    return new WorkflowResponse(results);
  }
);
