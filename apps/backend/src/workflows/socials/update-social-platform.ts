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

    // `updateSocialPlatforms({ selector, data })` returns an array of updated
    // entities — normalize to a single record so downstream (refetch, event)
    // can rely on `result.id`.
    const updatedResult = await service.updateSocialPlatforms({
      selector: { id },
      data: updateData,
    }) as unknown;
    const updated = (Array.isArray(updatedResult) ? updatedResult[0] : updatedResult) as SocialPlatform;

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
      // Use the input id — always present — rather than relying on
      // result.id, which has historically been undefined when the service
      // returned an array.
      data: {
        id: input.id,
      },
    })
    return new WorkflowResponse(result);
  }
);
