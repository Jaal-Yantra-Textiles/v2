import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Agreement, CreateAgreement, AgreementQueryParamsType } from "./validators";
import { refetchAgreement } from "./helpers";
import { createAgreementWorkflow } from "../../../workflows/agreements/create-agreement";
import { listAgreementWorkflow } from "../../../workflows/agreements/list-agreement";

export const GET = async (req: MedusaRequest<AgreementQueryParamsType>, res: MedusaResponse) => {
  const queryParams = req.validatedQuery || {};
  
  // Map 'q' to 'search' for consistency with other endpoints
  const searchParam = queryParams.q || queryParams.search;
  
  // Build filters object
  const filters: Record<string, any> = {};
  if (searchParam) {
    filters.title = { $ilike: `%${searchParam}%` }; // Search in title field
  }
  if (queryParams.status) {
    filters.status = queryParams.status;
  }
  
  const { result } = await listAgreementWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        skip: queryParams.offset || 0,
        take: queryParams.limit || 20,
        select: undefined, // Can be customized later
        relations: undefined, // Can be customized later
      },
    },
  });
  
  res.status(200).json({ agreements: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<CreateAgreement>, res: MedusaResponse) => {
  const { result } = await createAgreementWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      content: req.validatedBody.content || "", // Ensure content is always a string
    },
  });

  const agreement = await refetchAgreement(result.id, req.scope);
  res.status(201).json({ agreement });
};
