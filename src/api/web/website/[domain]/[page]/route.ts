import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { findWebsitePagePerDomainWorkflow } from "../../../../../workflows/website/find-website-page-per-domain";

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { domain, page } = req.params;

  try {
    const { result, errors } = await findWebsitePagePerDomainWorkflow(req.scope).run({
      input: {
        domain,
        pageSlug: page,
        exclude: "Blog"
      },
    });

    if (errors.length > 0) {
      throw errors;
    }

    // Only return necessary data for public consumption
    const publicPageData = {
      title: result.page.title,
      slug: result.page.slug,
      content: result.page.content,
      status: result.page.status,
      page_type: result.page.page_type,
      published_at: result.page.published_at,
      blocks: result.page.blocks?.map(block => ({
        id: block.id,
        name: block.name,
        type: block.type,
        content: block.content,
        order: block.order,
      })) || [],
    };

    res.status(200).json(publicPageData);
  } catch (error) {
    if (error.message === "Website not found") {
      res.status(404).json({
        message: "Website not found",
      });
      return;
    }
    if (error.message === "Page not found") {
      res.status(404).json({
        message: "Page not found",
      });
      return;
    }
    throw error;
  }
};
