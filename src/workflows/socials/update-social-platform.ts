import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPlatformService from "../../modules/socials/service";

export type UpdateSocialPlatformStepInput = {
  id: string;
  name?: string;
  icon_url?: string;
  base_url?: string;
  api_config?: Record<string, unknown>;
};

export const updateSocialPlatformStep = createStep(
  "update--social-platform-step",
  async (input: UpdateSocialPlatformStepInput, { container }) => {
    const service: SocialPlatformService = container.resolve(SOCIALS_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveSocialPlatform(id);

    const updated = await service.updateSocialPlatforms({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: SocialPlatformService = container.resolve(SOCIALS_MODULE);
    await service.updateSocialPlatforms({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
  }
);

export type UpdateSocialPlatformWorkflowInput = UpdateSocialPlatformStepInput;

export const updateSocialPlatformWorkflow = createWorkflow(
  "update--social-platform",
  (input: UpdateSocialPlatformWorkflowInput) => {
    const result = updateSocialPlatformStep(input);
    return new WorkflowResponse(result);
  }
);
