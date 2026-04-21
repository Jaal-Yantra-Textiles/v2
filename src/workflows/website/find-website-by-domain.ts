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

export type FindWebsiteByDomainStepInput = {
  domain: string;
};

export const findWebsiteByDomainStep = createStep(
  "find-website-by-domain-step",
  async (input: FindWebsiteByDomainStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // 1. Direct domain lookup (primary path, unique index on website.domain)
    let [websites] = await websiteService.listAndCountWebsites(
      { domain: input.domain },
      { relations: ["pages"], take: 1 }
    );

    // 2. Alias lookup: check website_domain table for any additional domains
    //    (custom domains, marketing aliases) that map to the same website.
    if (!websites?.length) {
      const [aliasRows] = await (websiteService as any).listAndCountWebsiteDomains(
        { domain: input.domain },
        { take: 1 }
      );
      const websiteId = aliasRows?.[0]?.website_id;
      if (websiteId) {
        const website = await websiteService.retrieveWebsite(websiteId, {
          relations: ["pages"],
        });
        if (website) {
          websites = [website];
        }
      }
    }

    // 3. Fallback: resolve via partner.storefront_domain → partner.website_id.
    // Covers the window between provisioning and website row propagation,
    // or partners whose website_id was linked via an alternative flow.
    if (!websites?.length) {
      try {
        const partnerService: PartnerService = container.resolve("partner");
        const [partners] = await partnerService.listAndCountPartners(
          { storefront_domain: input.domain },
          { take: 1 }
        );
        const websiteId = (partners?.[0] as any)?.website_id;
        if (websiteId) {
          const website = await websiteService.retrieveWebsite(websiteId, {
            relations: ["pages"],
          });
          if (website) {
            websites = [website];
          }
        }
      } catch {
        // partner service may be unavailable in some contexts — fall through
      }
    }

    if (!websites?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `The website ${input.domain} was not found`
      );
    }

    const website = websites[0];

    // Sort pages: published first, then by date
    if (website.pages) {
      website.pages.sort((a: any, b: any) => {
        if (a.status === "Published" && b.status !== "Published") return -1;
        if (a.status !== "Published" && b.status === "Published") return 1;
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
