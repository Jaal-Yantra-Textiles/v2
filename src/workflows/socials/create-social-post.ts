import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPostService from "../../modules/socials/service";

export type CreateSocialPostStepInput = {
  platform_id: string;
  post_url?: string;
  caption?: string;
  status: "draft" | "scheduled" | "posted" | "failed" | "archived";
  scheduled_at?: Date;
  posted_at?: Date;
  insights?: Record<string, unknown>;
  media_attachments?: Record<string, unknown>;
  notes?: string;
  error_message?: string;
  related_item_type?: string;
  related_item_id?: string;
};

export const createSocialPostStep = createStep(
  "create-social-post-step",
  async (input: CreateSocialPostStepInput, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    const created = await service.createSocialPosts(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    await service.softDeleteSocialPosts(id);
  }
);

export type CreateSocialPostWorkflowInput = CreateSocialPostStepInput;

export const createSocialPostWorkflow = createWorkflow(
  "create-social-post",
  (input: CreateSocialPostWorkflowInput) => {
    const result = createSocialPostStep(input);
    return new WorkflowResponse(result);
  }
);
