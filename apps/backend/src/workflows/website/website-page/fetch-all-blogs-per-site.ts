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
  is_featured?: boolean;
  category?: string;
  limit?: number;
  page?: number;
};

export const fetchAllBlogsPerSiteStep = createStep(
  "fetch-all-blogs-per-site-step",
  async (input: FetchAllBlogsPerSiteStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Find website by domain
    const websites = await websiteService.listAndCountWebsites(
      { domain: input.domain },
      {
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

    // Build query filters for database-level filtering
    const pageFilters: any = {
      website_id: website.id,
      page_type: "Blog",
      status: "Published"
    };

    // Apply featured filter at database level if provided
    if (input.is_featured !== undefined) {
      pageFilters.public_metadata = {
        ...pageFilters.public_metadata,
        is_featured: input.is_featured
      };
    }

    // Fetch pages with filters applied at database level
    // Note: Category filtering is done in memory because it requires slug-to-title conversion
    const [allBlogPages] = await websiteService.listAndCountPages(
      pageFilters,
      {
        relations: ["blocks"],
        take: 1000, // Fetch all to apply category filter
      }
    );

    // Apply category filter in memory (requires slug conversion)
    let blogPages = allBlogPages;
    if (input.category) {
      const categoryFilter = input.category;
      blogPages = blogPages.filter(page => {
        const pageCategory = page.public_metadata?.category;
        if (typeof pageCategory !== 'string') return false;
        return pageCategory.toLowerCase().replace(/\s+/g, '-') === categoryFilter.toLowerCase();
      });
    }

    // Sort by published date (newest first)
    blogPages.sort((a, b) => {
      const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
      const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
      return dateB - dateA; // Descending order (newest first)
    });

    // Get total count after category filtering
    const totalCount = blogPages.length;

    // Apply pagination in memory
    if (input.page && input.limit) {
      const startIndex = (input.page - 1) * input.limit;
      const endIndex = startIndex + input.limit;
      blogPages = blogPages.slice(startIndex, endIndex);
    } else if (input.limit) {
      blogPages = blogPages.slice(0, input.limit);
    }

    // Sort blocks for each blog page if they exist
    blogPages.forEach(page => {
      if (page.blocks) {
        page.blocks.sort((a, b) => {
          return a.order - b.order;
        });
      }
    });

    // Return with metadata
    return new StepResponse({
      blogPages,
      meta: {
        total: totalCount,
        page: input.page || 1,
        limit: input.limit || totalCount,
        total_pages: input.limit ? Math.ceil(totalCount / input.limit) : 1,
      }
    });
  }
);

export type FetchAllBlogsPerSiteWorkflowInput = {
  domain: string;
  is_featured?: boolean;
  category?: string;
  limit?: number;
  page?: number;
};

export const fetchAllBlogsPerSiteWorkflow = createWorkflow(
  {
    name: "fetch-all-blogs-per-site",
    store: true,
    retentionTime: 90,
    storeExecution: true
  },
(input: FetchAllBlogsPerSiteWorkflowInput) => {
    const { domain, is_featured, category, limit, page } = input;

    const blogPages = fetchAllBlogsPerSiteStep({
      domain,
      is_featured,
      category,
      limit,
      page,
    });

    return new WorkflowResponse(blogPages);
  }
);
