import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { SOCIALS_MODULE } from "../../modules/socials";
import SocialPostService from "../../modules/socials/service";

export type ListSocialPostStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listSocialPostStep = createStep(
  "list-social-post-step",
  async (input: ListSocialPostStepInput, { container }) => {
    const service: SocialPostService = container.resolve(SOCIALS_MODULE);
    const results = await service.listAndCountSocialPosts(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListSocialPostWorkflowInput = ListSocialPostStepInput;

export const listSocialPostWorkflow = createWorkflow(
  "list-social-post",
  (input: ListSocialPostWorkflowInput) => {
    const results = listSocialPostStep(input);
    return new WorkflowResponse(results);
  }
);
