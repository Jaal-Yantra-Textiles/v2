import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { createPageWorkflow } from "../../../../../workflows/website/website-page/create-page";
import { CreatePagesSchema, PageSchema } from "./validators";
import {
  ListPageWorkflowInput,
  listPageWorkflow,
} from "../../../../../workflows/website/website-page/list-page";
import { WEBSITE_MODULE } from "../../../../../modules/website";
import WebsiteService from "../../../../../modules/website/service";

export const POST = async (
  req: MedusaRequest<CreatePagesSchema | PageSchema>,
  res: MedusaResponse,
) => {
  const websiteId = req.params.id;
  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE);

  // Verify website exists
  await websiteService.retrieveWebsite(websiteId);

  if ('pages' in req.validatedBody) {
    // Batch create pages
    const pages = req.validatedBody.pages;
    const createdPages = await Promise.all(
      pages.map(async (page) => {
        const { result } = await createPageWorkflow(req.scope).run({
          input: {
            ...page,
            website_id: websiteId,
          },
        });
        return result;
      })
    );
    res.status(201).json({ pages: createdPages });
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
