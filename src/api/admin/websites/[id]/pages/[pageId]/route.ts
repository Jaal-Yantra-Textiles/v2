import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { DeletePageSchema, UpdatePageSchema } from "../validators";
import { deletePageWorkflow } from "../../../../../../workflows/website/website-page/delete-page";
import { WEBSITE_MODULE } from "../../../../../../modules/website";
import WebsiteService from "../../../../../../modules/website/service";
import { refetchPage } from "../helpers";
import { updatePageWorkflow } from "../../../../../../workflows/website/website-page/update-page";

export const DELETE = async (
  req: MedusaRequest<DeletePageSchema>,
  res: MedusaResponse,
) => {
  const { pageId } = req.params;

  const { result, errors } = await deletePageWorkflow(req.scope).run({
    input: {
      id: pageId,
    },
  });

  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }
  res.status(200).json({
    id: pageId,
    object: "page",
    deleted: true,
  });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE);
  const { pageId } = req.params;

  try {
    const page = await websiteService.retrievePage(pageId);
    res.status(200).json({ page });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const PUT = async (
  req: AuthenticatedMedusaRequest<UpdatePageSchema>,
  res: MedusaResponse,
) => {
  
  const { id: websiteId, pageId } = req.params;
  const { result, errors } = await updatePageWorkflow(req.scope).run({
    input: {
      id: pageId,
      website_id: websiteId,
      ...req.validatedBody,
    },
  });

  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  console.log(result)

  
  const page = await refetchPage(result.id, websiteId, req.scope, ["*"]);

  res.status(200).json({ page });
};
