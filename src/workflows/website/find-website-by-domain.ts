import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../modules/website";
import WebsiteService from "../../modules/website/service";
import { MedusaError, MedusaErrorTypes } from "@medusajs/framework/utils";

export type FindWebsiteByDomainStepInput = {
  domain: string;
};

export const findWebsiteByDomainStep = createStep(
  "find-website-by-domain-step",
  async (input: FindWebsiteByDomainStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Find website by domain with its pages
    const websites = await websiteService.listAndCountWebsites(
      { domain: input.domain },
      {
        relations: ["pages"],
        take: 1,
      }
    );

    if (!websites[0]?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND, 
        `The website ${input.domain} was not found`
      );
    }

    const website = websites[0][0];

    // Sort pages by their status and published date
    if (website.pages) {
      website.pages.sort((a, b) => {
        // Published pages first
        if (a.status === "Published" && b.status !== "Published") return -1;
        if (a.status !== "Published" && b.status === "Published") return 1;

        // Then sort by published_at date if both are published
        if (a.status === "Published" && b.status === "Published") {
          const aDate = a.published_at ? new Date(a.published_at) : new Date(0);
          const bDate = b.published_at ? new Date(b.published_at) : new Date(0);
          return bDate.getTime() - aDate.getTime();
        }

        return 0;
      });
    }

    return new StepResponse(website);
  }
);

export type FindWebsiteByDomainWorkflowInput = FindWebsiteByDomainStepInput;

export const findWebsiteByDomainWorkflow = createWorkflow(
  "find-website-by-domain",
  (input: FindWebsiteByDomainWorkflowInput) => {
    const website = findWebsiteByDomainStep(input);
    return new WorkflowResponse(website);
  },
);
