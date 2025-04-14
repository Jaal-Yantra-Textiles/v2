import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../modules/website";
import WebsiteService from "../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";

export type FindWebsitePagePerDomainStepInput = {
  domain: string;
  pageSlug: string;
  exclude?: string;
};

export const findWebsitePagePerDomainStep = createStep(
  "find-website-page-per-domain-step",
  async (input: FindWebsitePagePerDomainStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Find website by domain with its pages
    const websites = await websiteService.listAndCountWebsites(
      { domain: input.domain },
      {
        relations: ["pages", "pages.blocks"],
        take: 1,
      }
    );

    if (!websites[0]?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Website with domain ${input.domain} not found`
      )
    }

    const website = websites[0][0];

    // Return the specific page
    const page = website.pages?.find(
      (p) =>
        p.slug === input.pageSlug &&
        p.status === "Published" &&
        (input.exclude ? p.page_type !== input.exclude : p.page_type === "Blog")
    );

    if (!page) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Page with slug - ${input.pageSlug} not found and if you are trying to access blog page then use the /blogs endpoint`
      );
    }

    // Sort blocks if they exist
    if (page.blocks) {
      page.blocks.sort((a, b) => {
        return (a.order || 0) - (b.order || 0);
      });
    }

    return new StepResponse({
      page,
      website: {
        name: website.name,
        domain: website.domain
      }
    });
  }
);

export type FindWebsitePagePerDomainWorkflowInput = {
  domain: string;
  pageSlug: string;
  exclude?: string;
};

export const findWebsitePagePerDomainWorkflow = createWorkflow(
  {
    name: "find-website-page-per-domain",
    store: true
  },
  (input: FindWebsitePagePerDomainWorkflowInput) => {
    const result = findWebsitePagePerDomainStep(input);
    return new WorkflowResponse(result);
  }
);
