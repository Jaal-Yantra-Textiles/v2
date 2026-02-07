
/**
 * GET handler for checking media dictionaries existence.
 *
 * Invokes the getMediaDictionariesWorkflow from the media workflows in the request scope
 * and returns the workflow result as JSON. If the workflow reports any errors, the handler
 * responds with HTTP 500 and a combined error message.
 *
 * @param req - MedusaRequest representing the incoming request (provides scope for workflows).
 * @param res - MedusaResponse used to send the JSON response.
 *
 * @returns HTTP 200 with the workflow result on success:
 *  - Content-Type: application/json
 *  - Body: result object returned by getMediaDictionariesWorkflow
 *
 * @returns HTTP 500 with an aggregated error message when the workflow returns errors:
 *  - Content-Type: application/json
 *  - Body: { message: string } where message is a semicolon-separated list of error messages
 *
 * @example
 * // Curl example
 * curl -X GET "https://your-domain.com/admin/medias/existdir" \
 *   -H "Authorization: Bearer <admin-token>" \
 *   -H "Content-Type: application/json"
 *
 * // Successful response (200)
 * // {
 * //   "someKey": ["dictionary1", "dictionary2"],
 * //   "otherKey": { ... }
 * // }
 *
 * // Error response (500)
 * // {
 * //   "message": "Failed to load dictionaries; Another error message"
 * // }
 *
 * @example
 * // Node / browser fetch example
 * const res = await fetch("/admin/medias/existdir", {
 *   method: "GET",
 *   headers: {
 *     "Authorization": `Bearer ${adminToken}`,
 *     "Content-Type": "application/json",
 *   },
 * });
 *
 * if (res.ok) {
 *   const result = await res.json();
 *   // handle result
 * } else {
 *   const err = await res.json();
 *   // err.message contains aggregated error messages
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMediaDictionariesWorkflow } from "../../../../workflows/media/get-dictionaries"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result, errors } = await getMediaDictionariesWorkflow(req.scope).run()
  if (errors?.length) {
    return res.status(500).json({ message: errors.map((e: any) => e?.error?.message).filter(Boolean).join("; ") })
  }
  res.status(200).json(result)
}
