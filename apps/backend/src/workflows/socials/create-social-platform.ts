import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPlatformService from "../../modules/socials/service";
import { emitEventStep } from "@medusajs/medusa/core-flows";

export type CreateSocialPlatformStepInput = {
  name: string;
  category?: string;
  auth_type?: string;
  icon_url?: string | null;
  base_url?: string | null;
  description?: string | null;
  status?: string;
  api_config?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export const createSocialPlatformStep = createStep(
  "create--social-platform-step",
  async (input: CreateSocialPlatformStepInput, { container }) => {
    const service: SocialPlatformService = container.resolve(SOCIALS_MODULE);
    const createdEntities = await service.createSocialPlatforms(input);
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
    // Create platform - encryption will be handled by subscriber
    const result = createSocialPlatformStep(input);
    emitEventStep({
      eventName: 'social_platform.created',
      data: {
        id: result.id
      }
    })
    return new WorkflowResponse(result);
  }
);
