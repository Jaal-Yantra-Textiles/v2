import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { findWebsiteByDomainWorkflow } from "../../../../workflows/website/find-website-by-domain";

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { domain } = req.params;

  try {
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
      name: result.name,
      domain: result.domain,
      pages: result.pages?.map(page => ({
        title: page.title,
        slug: page.slug,
        content: page.content,
        status: page.status,
        page_type: page.page_type,
        published_at: page.published_at,
        // Only include published pages
      })).filter(page => page.status === "Published") || [],
    };

    res.status(200).json(publicWebsiteData);
  } catch (error) {
    if (error.message === "Website not found") {
      res.status(404).json({
        message: "Website not found",
      });
      return;
    }
    throw error;
  }
};