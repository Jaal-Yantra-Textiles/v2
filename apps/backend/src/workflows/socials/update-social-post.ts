import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPostService from "../../modules/socials/service";

export type UpdateSocialPostStepInput = {
  id: string;
  platform_id?: string;
  post_url?: string;
  caption?: string;
  status?: "draft" | "scheduled" | "posted" | "failed" | "archived";
  scheduled_at?: Date;
  posted_at?: Date;
  insights?: Record<string, unknown>;
  media_attachments?: Record<string, unknown>;
  notes?: string;
  error_message?: string;
  related_item_type?: string;
  related_item_id?: string;
};

export const updateSocialPostStep = createStep(
  "update-social-post-step",
  async (input: UpdateSocialPostStepInput, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    const { id, ...updateData } = input;
    
    const original = await service.retrieveSocialPost(id);

    const updated = await service.updateSocialPosts([{
      selector: {
        id: id
      },
      data : {
        ...updateData
      }
    }]);

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    // The originalData contains the full entity, including the id.
    await service.updateSocialPosts([compensationData.originalData]);
  }
);

export type UpdateSocialPostWorkflowInput = UpdateSocialPostStepInput;

export const updateSocialPostWorkflow = createWorkflow(
  "update-social-post",
  (input: UpdateSocialPostWorkflowInput) => {
    const result = updateSocialPostStep(input);
    return new WorkflowResponse(result);
  }
);
