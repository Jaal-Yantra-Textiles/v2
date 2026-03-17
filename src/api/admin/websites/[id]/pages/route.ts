/**
 * @file Admin API route for managing website pages
 * @description Handles creation and listing of pages for a specific website
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { createPageWorkflow } from "../../../../../workflows/website/website-page/create-page";
import { createBulkPagesWorkflow } from "../../../../../workflows/website/website-page/create-bulk-pages";
import { CreatePagesSchema, PageSchema } from "./validators";
import {
  ListPageWorkflowInput,
  listPageWorkflow,
} from "../../../../../workflows/website/website-page/list-page";

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const websiteId = req.params.id;
  const body = req.validatedBody as CreatePagesSchema | PageSchema;

  if ("pages" in body) {
    const batchBody = body as CreatePagesSchema;

    const { result } = await createBulkPagesWorkflow(req.scope).run({
      input: {
        pages: batchBody.pages.map((page) => ({
          ...page,
          website_id: websiteId,
          genMetaDataLLM: page.genMetaDataLLM ?? false,
        })),
      },
    });

    if (result.errors.length > 0) {
      if (!result.created || result.created.length === 0) {
        return res.status(400).json({
          message: "Failed to create pages",
          errors: result.errors,
        });
      }
      return res.status(207).json({
        message: "Some pages were created successfully while others failed",
        pages: result.created,
        errors: result.errors,
      });
    }

    return res.status(201).json({
      message: "All pages created successfully",
      pages: result.created,
    });
  }

  const singleBody = body as PageSchema;
  const { result } = await createPageWorkflow(req.scope).run({
    input: {
      ...singleBody,
      website_id: websiteId,
      genMetaDataLLM: singleBody.genMetaDataLLM ?? false,
    },
  });

  res.status(201).json({ page: result });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const websiteId = req.params.id;
  const title = req.query.q as string | undefined;
  const status = req.query.status as string | undefined;
  const page_type = req.query.page_type as string | undefined;
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = parseInt(req.query.limit as string) || 10;

  const workflowInput: ListPageWorkflowInput = {
    website_id: websiteId,
    filters: {
      ...(title ? { title } : {}),
      ...(status ? { status } : {}),
      ...(page_type ? { page_type } : {}),
    },
    config: {
      skip: offset,
      take: limit,
    },
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
