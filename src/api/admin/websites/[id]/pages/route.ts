import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { createPageWorkflow } from "../../../../../workflows/website/website-page/create-page";
import { createBulkPagesWorkflow } from "../../../../../workflows/website/website-page/create-bulk-pages";
import { CreatePagesSchema, PageSchema } from "./validators";
import {
  ListPageWorkflowInput,
  listPageWorkflow,
} from "../../../../../workflows/website/website-page/list-page";

export const POST = async (
  req: MedusaRequest<CreatePagesSchema | PageSchema >,
  res: MedusaResponse,
) => {
  const websiteId = req.params.id;
  
  if ('pages' in req.validatedBody) {
    
    // Batch create pages using the bulk workflow
    const { result } = await createBulkPagesWorkflow(req.scope).run({
      input: {
        pages: req.validatedBody.pages.map(page => ({
          ...page,
          website_id: websiteId,
        })),
      },
    });
    // If we have any errors, return them along with any successfully created pages
    if (result.errors.length > 0) {
      // If no pages were created but we have errors
      if (!result.created || result.created.length === 0) {
        res.status(400).json({
          message: "Failed to create pages",
          errors: result.errors
        });
      } else {
        // If some pages were created but others failed
        res.status(207).json({
          message: "Some pages were created successfully while others failed",
          pages: result.created,
          errors: result.errors
        });
      }
    } else {
      // All pages created successfully
      res.status(201).json({ 
        message: "All pages created successfully",
        pages: result.created 
      });
    }
  } else {
    // Create single page
    const { result } = await createPageWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        website_id: websiteId,
      },
    });
    res.status(201).json({ page: result });
  }
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const websiteId = req.params.id;
  const { q, status, page_type } = req.query;
  const title = q;
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = parseInt(req.query.limit as string) || 10;

  const workflowInput: ListPageWorkflowInput = {
    website_id: websiteId,
    filters: {
      title,
      status,
      page_type,
    },
    config: {
      skip: offset,
      take: limit
    }
  };

  const { result } = await listPageWorkflow(req.scope).run({
    input: workflowInput,
  });

  const [pages, count] = result;

  res.json({
    pages,
    count,
    offset,
    limit,
    hasMore: offset + pages.length < count,
  });
};
