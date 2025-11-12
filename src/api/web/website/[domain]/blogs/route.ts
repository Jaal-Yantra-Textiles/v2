import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { fetchAllBlogsPerSiteWorkflow } from "../../../../../workflows/website/website-page/fetch-all-blogs-per-site";

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { domain } = req.params;

  try {
    const { result, errors } = await fetchAllBlogsPerSiteWorkflow(req.scope).run({
      input: {
        domain,
      },
    });

    if (errors.length > 0) {
      throw errors;
    }

    // Only return necessary data for public consumption
    const publicBlogPages = result.blogPages.map(page => ({
      title: page.title,
      slug: page.slug,
      content: page.content,
      status: page.status,
      page_type: page.page_type,
      published_at: page.published_at,
      public_metadata: page.public_metadata,
      blocks: page.blocks?.map(block => ({
        id: block.id,
        type: block.type,
        content: block.content,
        order: block.order,
      })) || [],
    }));
    

    res.status(200).json(publicBlogPages);
  } catch (error) {
    if (error.message === "Blogs not found") {
      res.status(404).json({
        message: "Blogs not found",
      });
      return;
    }
    if (error.message === "Blogs not found") {
      res.status(404).json({
        message: "Blogs not found",
      });
      return;
    }
    throw error;
  }
};
