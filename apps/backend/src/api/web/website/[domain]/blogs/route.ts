import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { fetchAllBlogsPerSiteWorkflow } from "../../../../../workflows/website/website-page/fetch-all-blogs-per-site";

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { domain } = req.params;
  
  // Extract query parameters for filtering
  const { 
    is_featured, 
    category, 
    limit, 
    page 
  } = req.query as { 
    is_featured?: string; 
    category?: string; 
    limit?: string; 
    page?: string;
  };

  try {
    // Pass filter parameters to workflow
    const { result, errors } = await fetchAllBlogsPerSiteWorkflow(req.scope).run({
      input: {
        domain,
        is_featured: is_featured !== undefined ? (is_featured === 'true' || is_featured === '1') : undefined,
        category,
        limit: limit ? parseInt(limit, 10) : undefined,
        page: page ? parseInt(page, 10) : undefined,
      },
    });

    if (errors.length > 0) {
      throw errors;
    }

    // Map to public data format
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

    // Return with metadata from workflow
    res.status(200).json({
      data: publicBlogPages,
      meta: result.meta
    });
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
