import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import FolderService from "../../modules/media/service";

export type GetFolderStepInput = {
  id: string;
  config?: {
    select?: string[];
    relations?: string[];
  };
};

export const getFolderStep = createStep(
  "get-folder-step",
  async (input: GetFolderStepInput, { container }) => {
    const service: FolderService = container.resolve(MEDIA_MODULE);
    const folder = await service.retrieveFolder(
      input.id,
      input.config
    );
    return new StepResponse(folder);
  }
);

export type GetFolderWorkflowInput = GetFolderStepInput;

export const getFolderWorkflow = createWorkflow(
  "get-folder",
  (input: GetFolderWorkflowInput) => {
    const folder = getFolderStep(input);
    return new WorkflowResponse(folder);
  }
);
