import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { DeleteWebsiteSchema, UpdateWebsiteSchema } from "../validators";
import { deleteWebsiteWorkflow } from "../../../../workflows/website/delete-website";
import { WEBSITE_MODULE } from "../../../../modules/website";
import WebsiteService from "../../../../modules/website/service";
import { updateWebsiteWorkflow } from "../../../../workflows/website/update-website";
import { refetchWebsite } from "../helpers";

export const DELETE = async (
  req: MedusaRequest<DeleteWebsiteSchema>,
  res: MedusaResponse,
) => {
  const { id } = req.params;

  const { result, errors } = await deleteWebsiteWorkflow(req.scope).run({
    input: {
      id: id,
    },
  });
  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }
  res.status(200).json({
    id,
    object: "website",
    deleted: true,
  });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE);
  const { id } = req.params;

  try {
    const website = await websiteService.retrieveWebsite(id, 
      {
        relations:['pages']  
      }
    );
    res.status(200).json({ website });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const PUT = async (
  req: AuthenticatedMedusaRequest<UpdateWebsiteSchema>,
  res: MedusaResponse,
) => {
  const { id } = req.params;
 
  const { result, errors } = await updateWebsiteWorkflow(req.scope).run({
    input: {
      id,
      ...req.validatedBody,
    },
  });

  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const website = await refetchWebsite(result[0].id, req.scope);

  res.status(200).json({ website });
};
