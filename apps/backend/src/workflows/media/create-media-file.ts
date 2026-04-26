import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MEDIA_MODULE } from "../../modules/media";
import MediaFileService from "../../modules/media/service";

export type CreateMediaFileStepInput = {
  file_name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  file_type: "image" | "video" | "audio" | "document" | "archive" | "other";
  mime_type: string;
  extension: string;
  alt_text?: string;
  title?: string;
  description?: string;
  folder_id?: string;
  is_public?: boolean;
  metadata?: Record<string, any>;
  tags?: Record<string, any>;
};

export const createMediaFileStep = createStep(
  "create-media-file-step",
  async (input: CreateMediaFileStepInput, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    const created = await service.createMediaFiles(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE);
    await service.softDeleteMediaFiles(id);
  }
);

export type CreateMediaFileWorkflowInput = CreateMediaFileStepInput;

export const createMediaFileWorkflow = createWorkflow(
  "create-media-file",
  (input: CreateMediaFileWorkflowInput) => {
    const result = createMediaFileStep(input);
    return new WorkflowResponse(result);
  }
);
