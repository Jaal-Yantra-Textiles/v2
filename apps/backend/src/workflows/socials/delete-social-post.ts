import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPostService from "../../modules/socials/service";

export type DeleteSocialPostStepInput = {
  id: string;
};

export const deleteSocialPostStep = createStep(
  "delete-social-post-step",
  async (input: DeleteSocialPostStepInput, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    const original = await service.retrieveSocialPost(input.id);

    await service.deleteSocialPosts(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    await service.createSocialPosts(original);
  }
);

export type DeleteSocialPostWorkflowInput = DeleteSocialPostStepInput;

export const deleteSocialPostWorkflow = createWorkflow(
  "delete-social-post",
  (input: DeleteSocialPostWorkflowInput) => {
    const result = deleteSocialPostStep(input);
    return new WorkflowResponse(result);
  }
);
