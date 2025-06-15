import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateSocialPlatform } from "../validators";
import { refetchSocialPlatform } from "../helpers";
import { listSocialPlatformWorkflow } from "../../../../workflows/socials/list-social-platform";
import { updateSocialPlatformWorkflow } from "../../../../workflows/socials/update-social-platform";
import { deleteSocialPlatformWorkflow } from "../../../../workflows/socials/delete-social-platform";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listSocialPlatformWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ socialPlatform: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateSocialPlatform>, res: MedusaResponse) => {
  const { result } = await updateSocialPlatformWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  const socialPlatform = await refetchSocialPlatform(result.id, req.scope);
  res.status(200).json({ socialPlatform });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteSocialPlatformWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "social_platform",
    deleted: true,
  });
};
