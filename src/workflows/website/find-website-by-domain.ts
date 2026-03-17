import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../modules/website";
import WebsiteService from "../../modules/website/service";
import { MedusaError } from "@medusajs/framework/utils";

export type FindWebsiteByDomainStepInput = {
  domain: string;
};

export const findWebsiteByDomainStep = createStep(
  "find-website-by-domain-step",
  async (input: FindWebsiteByDomainStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // 1. Direct domain lookup
    let [websites] = await websiteService.listAndCountWebsites(
      { domain: input.domain },
      { relations: ["pages"], take: 1 }
    );

    // 2. Fallback: if domain looks like a Vercel preview URL, extract the handle
    // Format: storefront-{handle}-{hash}-{user}.vercel.app
    if (!websites?.length && input.domain.includes(".vercel.app")) {
      const match = input.domain.match(/^storefront-([a-z0-9-]+?)-[a-z0-9]+-/);
      if (match) {
        const handle = match[1];
        // Look up by domain containing the handle
        const [allWebsites] = await websiteService.listAndCountWebsites(
          {},
          { relations: ["pages"], take: 100 }
        );

        const found = allWebsites.find((w: any) =>
          w.domain?.includes(handle)
        );

        if (found) {
          websites = [found];
        }
      }
    }

    // 3. Fallback: try subdomain match (e.g. "sharlho.cicilabel.com" matches "sharlho")
    if (!websites?.length) {
      const subdomain = input.domain.split(".")[0];
      if (subdomain && subdomain !== "www") {
        const [allWebsites] = await websiteService.listAndCountWebsites(
          {},
          { relations: ["pages"], take: 100 }
        );

        const found = allWebsites.find((w: any) => {
          const wSubdomain = w.domain?.split(".")?.[0];
          return wSubdomain === subdomain;
        });

        if (found) {
          websites = [found];
        }
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
