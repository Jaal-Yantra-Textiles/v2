import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../modules/website";
import WebsiteService from "../../modules/website/service";
import PartnerService from "../../modules/partner/service";
import { MedusaError } from "@medusajs/framework/utils";

export type FindWebsitePagePerDomainStepInput = {
  domain: string;
  pageSlug: string;
  exclude?: string;
};

const PAGE_RELATIONS = ["pages", "pages.blocks"] as const;

export const findWebsitePagePerDomainStep = createStep(
  "find-website-page-per-domain-step",
  async (input: FindWebsitePagePerDomainStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // The resolution order mirrors findWebsiteByDomainStep so /web/website/:domain
    // and /web/website/:domain/:page agree on what a "domain" means: primary
    // domain, alias row, or partner.storefront_domain fallback.

    // 1. Direct domain lookup (primary path, unique index on website.domain).
    let websiteRow: any | undefined
    {
      const [list] = await websiteService.listAndCountWebsites(
        { domain: input.domain },
        { relations: [...PAGE_RELATIONS], take: 1 }
      );
      websiteRow = list?.[0];
    }

    // 2. Alias lookup: check website_domain table for additional domains
    //    (custom domains, marketing aliases) mapped to the same website.
    if (!websiteRow) {
      const [aliasRows] = await (websiteService as any).listAndCountWebsiteDomains(
        { domain: input.domain },
        { take: 1 }
      );
      const websiteId = aliasRows?.[0]?.website_id;
      if (websiteId) {
        websiteRow = await websiteService.retrieveWebsite(websiteId, {
          relations: [...PAGE_RELATIONS],
        });
      }
    }

    // 3. Partner fallback: partner.storefront_domain → partner.website_id.
    //    Covers the window between provisioning and website row propagation,
    //    or partners whose website_id was linked via an alternative flow.
    if (!websiteRow) {
      try {
        const partnerService: PartnerService = container.resolve("partner");
        const [partners] = await partnerService.listAndCountPartners(
          { storefront_domain: input.domain },
          { take: 1 }
        );
        const websiteId = (partners?.[0] as any)?.website_id;
        if (websiteId) {
          websiteRow = await websiteService.retrieveWebsite(websiteId, {
            relations: [...PAGE_RELATIONS],
          });
        }
      } catch {
        // partner service may be unavailable in some contexts — fall through
      }
    }

    if (!websiteRow) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Website with domain ${input.domain} not found`
      )
    }

    const website = websiteRow;

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
