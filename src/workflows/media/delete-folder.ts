import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import FolderService from "../../modules/media/service";

export type DeleteFolderStepInput = {
  id: string;
};

export const deleteFolderStep = createStep(
  "delete-folder-step",
  async (input: DeleteFolderStepInput, { container }) => {
    const service: FolderService = container.resolve(MEDIA_MODULE);
    const original = await service.retrieveFolder(input.id);

    await service.deleteFolders(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: FolderService = container.resolve(MEDIA_MODULE);
    await service.createFolders(original);
  }
);

export type DeleteFolderWorkflowInput = DeleteFolderStepInput;

export const deleteFolderWorkflow = createWorkflow(
  "delete-folder",
  (input: DeleteFolderWorkflowInput) => {
    const result = deleteFolderStep(input);
    return new WorkflowResponse(result);
  }
);
