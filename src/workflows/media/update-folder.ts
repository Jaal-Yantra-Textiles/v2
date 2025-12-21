import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import FolderService from "../../modules/media/service";

export type UpdateFolderStepInput = {
  id: string;
  name?: string;
  description?: string | null;
  path?: string;
  level?: number;
  sort_order?: number;
  is_public?: boolean;
  metadata?: Record<string, any> | null;
  parent_folder_id?: string | null;
};

export const updateFolderStep = createStep(
  "update-folder-step",
  async (input: UpdateFolderStepInput, { container }) => {
    const service: FolderService = container.resolve(MEDIA_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveFolder(id);

    const updated = await service.updateFolders({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: FolderService = container.resolve(MEDIA_MODULE);
    await service.updateFolders({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
  }
);

export type UpdateFolderWorkflowInput = UpdateFolderStepInput;

export const updateFolderWorkflow = createWorkflow(
  "update-folder",
  (input: UpdateFolderWorkflowInput) => {
    const result = updateFolderStep(input);
    return new WorkflowResponse(result);
  }
);
