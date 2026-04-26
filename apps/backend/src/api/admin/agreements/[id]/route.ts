
/**
 * Route handlers for /api/admin/agreements/[id]
 *
 * GET
 * - Purpose: Retrieve a single agreement by id.
 * - Input: req.params.id (string)
 * - Action: Runs listAgreementWorkflow with a filter on id.
 * - Output: 200 JSON { agreement }
 *
 * POST
 * - Purpose: Update an agreement by id.
 * - Input:
 *    - req.params.id (string)
 *    - req.validatedBody (UpdateAgreement) — validated update payload
 * - Action: Runs updateAgreementWorkflow with id + validated body, then refetches the updated agreement.
 * - Output: 200 JSON { agreement } (freshly refetched)
 *
 * DELETE
 * - Purpose: Delete an agreement by id.
 * - Input: req.params.id (string)
 * - Action: Runs deleteAgreementWorkflow for the id.
 * - Output: 200 JSON { id, object: "agreement", deleted: true }
 *
 * Notes:
 * - All handlers use the request scope (req.scope) to resolve services/workflows.
 * - All responses use HTTP 200 on success and return JSON as described above.
 *
 * @example
 * // GET
 * fetch('/api/admin/agreements/agr_123', { method: 'GET' })
 *   .then(r => r.json()) // { agreement: { id: 'agr_123', ... } }
 *
 * // POST (update)
 * fetch('/api/admin/agreements/agr_123', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ title: 'New Title' })
 * }).then(r => r.json()) // { agreement: { id: 'agr_123', title: 'New Title', ... } }
 *
 * // DELETE
 * fetch('/api/admin/agreements/agr_123', { method: 'DELETE' })
 *   .then(r => r.json()) // { id: 'agr_123', object: 'agreement', deleted: true }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateAgreement } from "../validators";
import { refetchAgreement } from "../helpers";
import { listAgreementWorkflow } from "../../../../workflows/agreements/list-agreement";
import { updateAgreementWorkflow } from "../../../../workflows/agreements/update-agreement";
import { deleteAgreementWorkflow } from "../../../../workflows/agreements/delete-agreement";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listAgreementWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ agreement: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateAgreement>, res: MedusaResponse) => {
  const { result } = await updateAgreementWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });

  const agreement = await refetchAgreement(result[0].id, req.scope);
  res.status(200).json({ agreement });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteAgreementWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "agreement",
    deleted: true,
  });
};
