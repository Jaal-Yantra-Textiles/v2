
/**
 * Handlers for the admin Email Template route: /admin/email-templates/[id]
 *
 * Provides three HTTP handlers exported from this module:
 * - GET:    Retrieve a single email template by id.
 * - POST:   Update an email template by id (expects validated UpdateEmailTemplate body).
 * - DELETE: Remove an email template by id.
 *
 * Common behavior:
 * - All handlers accept a MedusaRequest and MedusaResponse.
 * - id is read from req.params.id.
 * - Responses are JSON and use HTTP 200 for successful operations.
 *
 * GET
 * - Description: Fetches the email template with the given id and returns it under the `emailTemplate` key.
 * - Input: req.params.id
 * - Response: { emailTemplate: Record<string, any> }
 *
 * POST
 * - Description: Updates the email template identified by req.params.id using the validated body (UpdateEmailTemplate),
 *   then re-fetches the persisted template and returns it under `emailTemplate`.
 * - Input: req.params.id, req.validatedBody (UpdateEmailTemplate)
 * - Response: { emailTemplate: Record<string, any> }
 *
 * DELETE
 * - Description: Deletes the email template identified by req.params.id.
 * - Input: req.params.id
 * - Response: { id: string, object: "emailtemplate", deleted: true }
 *
 * @module admin/email-templates/[id]/route
 *
 * @param req - MedusaRequest. For POST, req.validatedBody must conform to UpdateEmailTemplate. The template id must be supplied in req.params.id.
 * @param res - MedusaResponse. Handlers write JSON responses and appropriate HTTP status codes.
 *
 * @returns Promise<void> - Handlers send HTTP responses directly (no value returned).
 *
 * @example
 * // GET example (curl)
 * // Fetch template with id "tpl_123"
 * // Response: { "emailTemplate": { /* template fields *\/ } }
 * curl -X GET "https://api.example.com/admin/email-templates/tpl_123" \
 *   -H "Authorization: Bearer <admin_token>"
 *
 * @example
 * // POST example (curl)
 * // Update template title and body for id "tpl_123"
 * curl -X POST "https://api.example.com/admin/email-templates/tpl_123" \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer <admin_token>" \
 *   -d '{
 *     "title": "Welcome, {{ first_name }}",
 *     "subject": "Welcome to Example",
 *     "body": "<p>Hello {{ first_name }}, welcome!</p>"
 *   }'
 * // Response: { "emailTemplate": { /* updated template fields *\/ } }
 *
 * @example
 * // DELETE example (curl)
 * // Delete template with id "tpl_123"
 * // Response: { "id": "tpl_123", "object": "emailtemplate", "deleted": true }
 * curl -X DELETE "https://api.example.com/admin/email-templates/tpl_123" \
 *   -H "Authorization: Bearer <admin_token>"
 *
 * @remarks
 * - Validation of the POST payload is performed prior to invoking the update workflow; callers should ensure
 *   the request body matches the UpdateEmailTemplate validator shape.
 * - Errors from underlying workflows are propagated as HTTP error responses by the surrounding framework.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateEmailTemplate } from "../validators";
import { refetchEmailTemplate } from "../helpers";
import { listEmailTemplateWorkflow } from "../../../../workflows/email_templates/list-email-template";
import { updateEmailTemplateWorkflow } from "../../../../workflows/email_templates/update-email-template";
import { deleteEmailTemplateWorkflow } from "../../../../workflows/email_templates/delete-email-template";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listEmailTemplateWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ emailTemplate: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateEmailTemplate>, res: MedusaResponse) => {
  const { result } = await updateEmailTemplateWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });

  const emailTemplate = await refetchEmailTemplate(result[0].id, req.scope);
  res.status(200).json({ emailTemplate });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteEmailTemplateWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "emailtemplate",
    deleted: true,
  });
};
