import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { SocialPost } from "./validators";
import { refetchSocialPost } from "./helpers";
import { createSocialPostWorkflow } from "../../../workflows/socials/create-social-post";
import { listSocialPostWorkflow } from "../../../workflows/socials/list-social-post";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { q, status, posted_at, error_message, limit, offset } = req.validatedQuery;

  const filters: Record<string, any> = {};
  if (q) {
    filters.name = q;
  }
  if (status) {
    filters.status = status;
  }
  if (posted_at) {
    filters.posted_at = posted_at;
  }
  if (error_message) {
    filters.error_message = error_message;
  }

  const { result } = await listSocialPostWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        take: limit,
        skip: offset,
      },
    },
  });
  res.status(200).json({ socialPosts: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<SocialPost>, res: MedusaResponse) => {
  console.log(req.validatedBody)
  const { result } = await createSocialPostWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  console.log(result)
  const socialpost = await refetchSocialPost(result.id, req.scope);
  res.status(201).json({ socialPost: socialpost });
};
