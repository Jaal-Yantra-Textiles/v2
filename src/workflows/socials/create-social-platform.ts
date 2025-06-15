import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPlatformService from "../../modules/socials/service";

export type CreateSocialPlatformStepInput = {
  name: string;
  icon_url?: string;
  base_url?: string;
  api_config?: Record<string, unknown>;
};

export const createSocialPlatformStep = createStep(
  "create--social-platform-step",
  async (input: CreateSocialPlatformStepInput, { container }) => {
    const service: SocialPlatformService = container.resolve(SOCIALS_MODULE);
    console.log(input)
    const createdEntities = await service.createSocialPlatforms(input);
    console.log(createdEntities)
    const platform = Array.isArray(createdEntities) ? createdEntities[0] : createdEntities;
    return new StepResponse(platform, platform?.id);
  },
  async (id: string, { container }) => {
    const service: SocialPlatformService = container.resolve(SOCIALS_MODULE);
    await service.softDeleteSocialPlatforms(id);
  }
);

export type CreateSocialPlatformWorkflowInput = CreateSocialPlatformStepInput;

export const createSocialPlatformWorkflow = createWorkflow(
  "create--social-platform",
  (input: CreateSocialPlatformWorkflowInput) => {
    const result = createSocialPlatformStep(input);
    return new WorkflowResponse(result);
  }
);
