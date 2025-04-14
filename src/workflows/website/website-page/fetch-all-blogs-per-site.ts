import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";


export type FetchAllBlogsPerSiteStepInput = {
  domain: string;
};

export const fetchAllBlogsPerSiteStep = createStep(
  "fetch-all-blogs-per-site-step",
  async (input: FetchAllBlogsPerSiteStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Find website by domain with its pages
    const websites = await websiteService.listAndCountWebsites(
      { domain: input.domain,  },
      {
        relations: ["pages", "pages.blocks"],
        take: 1,
      }
    );

    const pages = await websiteService.listAndCountPages({
      website_id: websites[0][0].id,
      page_type: "Blog",
      status: "Published"
    }, {
      relations: ["blocks"],
      take: 100
    });

    if (!websites[0]?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Website with domain ${input.domain} not found`
      )
    }

    const website = websites[0][0];

    // Filter pages to only include blog-type pages with Published status
    const blogPages = website.pages?.filter(p => 
      p.page_type === "Blog" && p.status === "Published"
    ) || [];

    // Sort blocks for each blog page if they exist
    blogPages.forEach(page => {
      if (page.blocks) {
        page.blocks.sort((a, b) => {
          return a.order - b.order;
        });
      }
    });

    return new StepResponse({
      blogPages
    });
  }
);

export type FetchAllBlogsPerSiteWorkflowInput = {
  domain: string;
};

export const fetchAllBlogsPerSiteWorkflow = createWorkflow(
  {
    name: "fetch-all-blogs-per-site",
    store: true,
    retentionTime: 90,
    storeExecution: true
  },
(input: FetchAllBlogsPerSiteWorkflowInput) => {
    const { domain } = input;

    const blogPages = fetchAllBlogsPerSiteStep({
      domain,
    });

    return new WorkflowResponse(blogPages);
  }
);
