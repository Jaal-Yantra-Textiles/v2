import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { SocialPost } from "./validators";
import { refetchSocialPost } from "./helpers";
import { createSocialPostWorkflow } from "../../../workflows/socials/create-social-post";
import { listSocialPostWorkflow } from "../../../workflows/socials/list-social-post";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // TODO: Add query param parsing for filters, pagination, etc.
  const { result } = await listSocialPostWorkflow(req.scope).run({
    input: {},
  });
  res.status(200).json({ socialposts: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<SocialPost>, res: MedusaResponse) => {
  const { result } = await createSocialPostWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  const socialpost = await refetchSocialPost(result.id, req.scope);
  res.status(201).json({ socialpost });
};
