import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import FolderService from "../../modules/media/service";

export type CreateFolderStepInput = {
  name: string;
  slug: string;
  description?: string;
  parent_folder_id?: string;
  path: string;
  level?: number;
  default_sort_order?: number;
  default_is_public?: boolean;
  metadata?: Record<string, any>;
};

export const createFolderStep = createStep(
  "create-folder-step",
  async (input: CreateFolderStepInput, { container }) => {
    const service: FolderService = container.resolve(MEDIA_MODULE);
    const created = await service.createFolders(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: FolderService = container.resolve(MEDIA_MODULE);
    await service.softDeleteFolders(id);
  }
);

export type CreateFolderWorkflowInput = CreateFolderStepInput;

export const createFolderWorkflow = createWorkflow(
  "create-folder",
  (input: CreateFolderWorkflowInput) => {
    const result = createFolderStep(input);
    return new WorkflowResponse(result);
  }
);
