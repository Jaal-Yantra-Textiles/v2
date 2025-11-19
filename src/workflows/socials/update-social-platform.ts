import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPlatformService from "../../modules/socials/service";
import { InferTypeOf } from "@medusajs/framework/types"

import SocialPlatform  from "../../modules/socials/models/SocialPlatform";
import { emitEventStep } from "@medusajs/medusa/core-flows";

export type SocialPlatform = InferTypeOf<typeof SocialPlatform>
export type UpdateSocialPlatformStepInput = {
  id: string;
  name?: string;
  category?: string;
  auth_type?: string;
  icon_url?: string | null;
  base_url?: string | null;
  description?: string | null;
  status?: string;
  api_config?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
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
    }) as unknown as SocialPlatform;
    
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
    emitEventStep({
          eventName: 'social_platform.updated',
          data: {
            id: result.id
          }
        })
    return new WorkflowResponse(result);
  }
);
