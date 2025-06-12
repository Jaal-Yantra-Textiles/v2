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

type GetWebsiteByDomainStepInput = {
  domain: string
}

const getWebsiteByDomainStep = createStep(
  "get-website-by-domain-step",
  async (input: GetWebsiteByDomainStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
    const websites = await websiteService.listWebsites(
      {
        domain: input.domain,
      },
      {
        select: ["id"],
        take: 1,
      }
    )

    const website = websites[0]

    if (!website) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Website with domain ${input.domain} not found`
      )
    }

    return new StepResponse(website)
  }
)

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

type WorkflowInput = {
  domain: string
}

export const fetchAllCategoriesPerSiteWorkflowId =
  "fetch-all-categories-per-site"
export const fetchAllCategoriesPerSiteWorkflow = createWorkflow(
  fetchAllCategoriesPerSiteWorkflowId,
  (input: WorkflowInput): WorkflowResponse<string[]> => {
    const website = getWebsiteByDomainStep(input)
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
