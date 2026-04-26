/**
 * Route handlers for admin agreement management.
 *
 * GET
 * - Purpose: List agreements with optional searching and filtering.
 * - Request:
 *   - req: MedusaRequest<AgreementQueryParamsType>
 *   - validatedQuery may include:
 *     - q | search?: string        // full-text search applied to `title` via ILIKE `%...%`
 *     - status?: string            // exact match filter on `status`
 *     - offset?: number            // pagination offset (default: 0)
 *     - limit?: number             // pagination limit (default: 20)
 * - Behavior:
 *   - Builds a `filters` object from query params (title $ilike, status).
 *   - Calls listAgreementWorkflow(req.scope).run({ input: { filters, config: { skip, take, select, relations } } }).
 * - Response:
 *   - 200 JSON: { agreements: Agreement[], count: number }
 *     - agreements === result[0]
 *     - count === result[1]
 *
 * POST
 * - Purpose: Create a new agreement.
 * - Request:
 *   - req: MedusaRequest<CreateAgreement>
 *   - validatedBody: CreateAgreement (ensures `content` is provided; defaults to "" if omitted)
 * - Behavior:
 *   - Calls createAgreementWorkflow(req.scope).run({ input: { ...validatedBody, content } }).
 *   - Refetches the created agreement via refetchAgreement(result.id, req.scope) to return the full resource.
 * - Response:
 *   - 201 JSON: { agreement: Agreement } (the refetched/complete agreement object)
 *
 * Common notes
 * - Both handlers forward req.scope to workflows.
 * - Workflow errors propagate (handled by framework/middleware).
 *
 * @param GET req - MedusaRequest<AgreementQueryParamsType>
 * @param GET res - MedusaResponse
 * @param POST req - MedusaRequest<CreateAgreement>
 * @param POST res - MedusaResponse
 * @returns Promise<void>
 */
/**
 * This route exposes GET and POST methods for agreement modules
 * 
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import {  CreateAgreement, AgreementQueryParamsType } from "./validators";
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
