
/**
 * API route handlers for managing email templates.
 *
 * GET /admin/email-templates
 * - Description: Lists email templates using query-based filters and pagination.
 * - Query parameters:
 *   - limit?: number - number of items to return
 *   - offset?: number - number of items to skip
 *   - order?: string - sorting order
 *   - fields?: string - comma separated fields to include
 *   - q?: string - full-text search term (added to search filters when present)
 *   - is_active?: boolean - filter by active state
 *   - template_type?: string - filter by template type
 *   - template_key?: string - filter by template key
 *   - ...filters - any additional filters supported by the workflow
 * - Response: 200 OK
 *   { emailTemplates: EmailTemplate[], count: number }
 *
 * POST /admin/email-templates
 * - Description: Creates a new email template and returns the freshly fetched resource.
 * - Body: CreateEmailTemplate (JSON)
 * - Response: 201 Created
 *   { emailTemplate: EmailTemplate }
 *
 * Remarks:
 * - Internally uses listEmailTemplateWorkflow and createEmailTemplateWorkflow bound to request scope.
 * - GET collects filters into a search object and includes `q` when provided.
 * - The list workflow returns a tuple where result[0] is the items array and result[1] is the total count.
 * - After creation, the POST handler re-fetches the created template (to return the complete resource).
 *
 * Examples:
 *
 * GET example:
 * curl -X GET "https://api.example.com/admin/email-templates?limit=10&offset=0&q=welcome&is_active=true" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * Response:
 * HTTP/1.1 200 OK
 * {
 *   "emailTemplates": [
 *     {
 *       "id": "tmpl_1",
 *       "name": "Welcome",
 *       "key": "welcome_email",
 *       "subject": "Welcome!",
 *       "is_active": true,
 *       // ...
 *     }
 *   ],
 *   "count": 1
 * }
 *
 * POST example:
 * curl -X POST "https://api.example.com/admin/email-templates" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "name": "Welcome",
 *     "key": "welcome_email",
 *     "subject": "Welcome!",
 *     "body": "<p>Hello {{customer.first_name}}</p>",
 *     "is_active": true,
 *     "template_type": "transactional"
 *   }'
 *
 * Response:
 * HTTP/1.1 201 Created
 * {
 *   "emailTemplate": {
 *     "id": "tmpl_2",
 *     "name": "Welcome",
 *     "key": "welcome_email",
 *     "subject": "Welcome!",
 *     "body": "<p>Hello {{customer.first_name}}</p>",
 *     "is_active": true,
 *     "template_type": "transactional"
 *     // ...
 *   }
 * }
 *
 * @public
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { refetchEmailTemplate } from "./helpers";
import { createEmailTemplateWorkflow } from "../../../workflows/email_templates/create-email-template";
import { listEmailTemplateWorkflow } from "../../../workflows/email_templates/list-email-template";
import { CreateEmailTemplate, EmailTemplateQueryParams } from "./validators";

export const GET = async (req: MedusaRequest<EmailTemplateQueryParams>, res: MedusaResponse) => {
  const { limit, offset, order, fields, q, is_active, template_type, template_key, ...filters } = req.validatedQuery;
  
  const searchFilters: any = {
    is_active,
    template_type,
    template_key,
    ...filters
  };
  
  if (q) {
    searchFilters.q = q;
  }
  
  const { result } = await listEmailTemplateWorkflow(req.scope).run({
    input: {
      filters: searchFilters,
      config: {
        take: limit,
        skip: offset,
      }
    },
  });
  res.status(200).json({ emailTemplates: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<CreateEmailTemplate>, res: MedusaResponse) => {
  const { result } = await createEmailTemplateWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  const emailTemplate = await refetchEmailTemplate(result.id, req.scope);
  res.status(201).json({ emailTemplate });
};
