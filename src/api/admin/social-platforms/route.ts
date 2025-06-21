import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { SocialPlatform } from "./validators";
import { refetchSocialPlatform } from "./helpers";
import { createSocialPlatformWorkflow } from "../../../workflows/socials/create-social-platform";
import { listSocialPlatformWorkflow } from "../../../workflows/socials/list-social-platform";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // TODO: Add query param parsing for filters, pagination, etc.
  const { result } = await listSocialPlatformWorkflow(req.scope).run({
    input: {
      filters: {
        name: req.validatedQuery.q,
      },
      config: {
        take: req.validatedQuery.limit,
        skip: req.validatedQuery.offset,
      },
    },
  });
  res.status(200).json({ socialPlatforms: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<SocialPlatform>, res: MedusaResponse) => {
  const { result } = await createSocialPlatformWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  const socialPlatform = await refetchSocialPlatform(result.id, req.scope);
  res.status(201).json({ socialPlatform });
};
