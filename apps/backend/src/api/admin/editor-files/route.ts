
/**
 * GET /admin/editor-files
 *
 * Retrieves a paginated list of editor files using the listEditorFilesWorkflow.
 *
 * Query Parameters:
 * - limit?: string - Maximum number of items to return. Parsed as integer. Defaults to 20.
 * - offset?: string - Number of items to skip. Parsed as integer. Defaults to 0.
 *
 * Behavior:
 * - Parses `limit` and `offset` from the request query and validates they are integers.
 * - Constructs a pagination object and passes it to `listEditorFilesWorkflow(req.scope).run`.
 * - Returns the workflow `result` as JSON with HTTP 200 on success.
 * - Returns HTTP 400 with `{ message: "Invalid limit or offset." }` if parsing fails.
 * - The workflow is invoked with `throwOnError: true`, so workflow failures will propagate and should be handled by upstream error middleware.
 *
 * Notes:
 * - This handler only supplies a `pagination` object to the workflow; other previously supported query params
 *   such as `q` and `mime_type_group` are not forwarded here.
 *
 * Examples:
 * - cURL:
 *   curl -X GET "https://your-domain.com/admin/editor-files?limit=10&offset=20" \
 *     -H "Authorization: Bearer <ADMIN_API_TOKEN>" \
 *     -H "Content-Type: application/json"
 *
 * - Browser / Fetch:
 *   fetch("/admin/editor-files?limit=5&offset=0", {
 *     method: "GET",
 *     headers: { "Authorization": "Bearer <ADMIN_API_TOKEN>" }
 *   }).then(res => res.json()).then(result => console.log(result))
 *
 * - Expected successful JSON shape (workflow-specific; example):
 *   {
 *     "items": [ /* array of editor file objects *\/ ],
 *     "count": 123,
 *     "limit": 10,
 *     "offset": 20
 *   }
 *
 * @param req - MedusaRequest with parsed query parameters
 * @param res - MedusaResponse used to send JSON responses
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { listEditorFilesWorkflow } from "../../../workflows/files/list-editor-files"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { limit, offset } = req.query

  const parsedLimit = limit ? parseInt(limit as string, 10) : 20
  const parsedOffset = offset ? parseInt(offset as string, 10) : 0

  if (isNaN(parsedLimit) || isNaN(parsedOffset)) {
    return res.status(400).json({ message: "Invalid limit or offset." })
  }
    const { result } = await listEditorFilesWorkflow(req.scope).run({
      input: {
        pagination: { // Workflow expects pagination object
          limit: parsedLimit,
          offset: parsedOffset,
        }
        // q and mime_type_group are no longer passed as they are not supported by the workflow
      },
      throwOnError: true,
    })

    res.status(200).json(result)
  }
