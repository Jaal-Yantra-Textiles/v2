import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { WEBSITE_MODULE } from "../../../modules/website"
import WebsiteService from "../../../modules/website/service"

type GetWebsiteStepInput = {
  domainName?: string
  websiteId?: string
}

const getWebsiteStep = createStep(
  "get-website-step",
  async (input: GetWebsiteStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    let filter = {};
    if (input.websiteId) {
      filter = { id: input.websiteId };
    } else if (input.domainName) {
      filter = { domain: input.domainName }; // Assuming 'domain' is the correct filter key for domain name
    } else {
      throw new Error("Either websiteId or domainName must be provided to fetch website.");
    }

    const websites = await websiteService.listWebsites(
      filter,
      {
        take: 1,
      }
    );

    const website = websites[0];

    if (!website) {
      let identifier = input.websiteId ? `ID ${input.websiteId}` : `domain ${input.domainName}`;
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Website with ${identifier} not found`
      );
    }
    // The step should return the website object itself, which includes categories if relations worked
    return new StepResponse(website, website.id);
  }
);

type GetWebsitePagesStepInput = {
  website: {
    id: string
  }
}

const getWebsitePagesStep = createStep(
  "get-website-pages-for-categories-step",
  async (input: GetWebsitePagesStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
    const pages = await websiteService.listPages(
      {
        website_id: input.website.id,
        page_type: 'Blog', // Only fetch blog posts
      },
      {
        select: ["public_metadata"],
      }
    )

    return new StepResponse(pages)
  }
)

interface WorkflowInput {
  domainName?: string
  websiteId?: string
}

export const fetchAllCategoriesPerSiteWorkflowId =
  "fetch-all-categories-per-site"
export const fetchAllCategoriesPerSiteWorkflow = createWorkflow(
  fetchAllCategoriesPerSiteWorkflowId,
  (input: WorkflowInput): WorkflowResponse<string[]> => {
    // Ensure either domainName or websiteId is provided
    if (!input.domainName && !input.websiteId) {
      throw new Error("Workflow input must include either domainName or websiteId.")
    }
    const website = getWebsiteStep(input)
    const pages = getWebsitePagesStep({ website })

    const categories = transform({ pages }, (data): string[] => {
      const allCategories = data.pages
        .map(
          (page) =>
            (page.public_metadata as { category?: string })?.category
        )
        .filter((category): category is string => !!category)

      const uniqueCategories = [...new Set(allCategories)]
      return uniqueCategories
    })

    return new WorkflowResponse(categories)
  }
)
