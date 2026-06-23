import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { findWebsiteByDomainWorkflow } from "../../../../workflows/website/find-website-by-domain";


export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { domain } = req.params;
    const { result, errors } = await findWebsiteByDomainWorkflow(req.scope).run({
      input: {
        domain,
      },
    });

    if (errors.length > 0) {
      throw errors;
    }

    // Only return necessary data for public consumption
    const publicWebsiteData = {
      // Stable id so storefronts can stamp it on outbound analytics events
      // (the in-house tracker reads this for `data-website-id`).
      id: (result as any).id,
      name: result.name,
      domain: result.domain,
      theme: result.theme || result.metadata?.theme || null,
      favicon_url: result.favicon_url || null,
      analytics: {
        provider: (result as any).analytics_provider ?? "in_house",
        custom_head: (result as any).analytics_custom_head ?? null,
        custom_body_end: (result as any).analytics_custom_body_end ?? null,
      },
      pages: result.pages?.map(page => ({
        title: page.title,
        slug: page.slug,
        content: page.content,
        status: page.status,
        page_type: page.page_type,
        published_at: page.published_at,
        // Only include published pages
      })).filter(page => page.status === "Published" &&
        page.page_type !== "Blog" &&
        page.page_type !== "Newsletter"
      ) || [],
    };

    res.status(200).json(publicWebsiteData);
};
