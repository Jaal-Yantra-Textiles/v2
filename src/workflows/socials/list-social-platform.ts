import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPlatformService from "../../modules/socials/service";

export type ListSocialPlatformStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listSocialPlatformStep = createStep(
  "list--social-platform-step",
  async (input: ListSocialPlatformStepInput, { container }) => {
    const service: SocialPlatformService = container.resolve(SOCIALS_MODULE);
    const results = await service.listAndCountSocialPlatforms(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListSocialPlatformWorkflowInput = ListSocialPlatformStepInput;

export const listSocialPlatformWorkflow = createWorkflow(
  "list--social-platform",
  (input: ListSocialPlatformWorkflowInput) => {
    const results = listSocialPlatformStep(input);
    return new WorkflowResponse(results);
  }
);
