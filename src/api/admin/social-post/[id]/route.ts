import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateSocialPost } from "../validators";
import { refetchSocialPost } from "../helpers";
import { listSocialPostWorkflow } from "../../../../workflows/socials/list-social-post";
import { updateSocialPostWorkflow } from "../../../../workflows/socials/update-social-post";
import { deleteSocialPostWorkflow } from "../../../../workflows/socials/delete-social-post";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listSocialPostWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ socialpost: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateSocialPost>, res: MedusaResponse) => {
  const { result } = await updateSocialPostWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });

  const socialpost = await refetchSocialPost(result[0].id, req.scope);
  res.status(200).json({ socialpost });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteSocialPostWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "socialpost",
    deleted: true,
  });
};
