import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPlatformService from "../../modules/socials/service";

export type DeleteSocialPlatformStepInput = {
  id: string;
};

export const deleteSocialPlatformStep = createStep(
  "delete--social-platform-step",
  async (input: DeleteSocialPlatformStepInput, { container }) => {
    const service: SocialPlatformService = container.resolve(SOCIALS_MODULE);
    const original = await service.retrieveSocialPlatform(input.id);

    await service.deleteSocialPlatforms(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: SocialPlatformService = container.resolve(SOCIALS_MODULE);
    await service.createSocialPlatforms(original);
  }
);

export type DeleteSocialPlatformWorkflowInput = DeleteSocialPlatformStepInput;

export const deleteSocialPlatformWorkflow = createWorkflow(
  "delete--social-platform",
  (input: DeleteSocialPlatformWorkflowInput) => {
    const result = deleteSocialPlatformStep(input);
    return new WorkflowResponse(result);
  }
);
