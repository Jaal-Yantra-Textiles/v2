/**
 * @route GET /admin/websites/{id}/blogs/categories
 * @description Fetches all blog categories for a specific website
 * @param {string} id - The website ID (required in URL path)
 * @returns {Object} 200 - Success response with categories array
 * @returns {Object} 400 - Bad request if website ID is missing
 * @returns {Object} 500 - Internal server error
 *
 * @example
 * // Request
 * GET /admin/websites/12345/blogs/categories
 *
 * @example
 * // Successful response (200)
 * {
 *   "categories": [
 *     {
 *       "id": "cat_123",
 *       "name": "Fashion",
 *       "slug": "fashion",
 *       "website_id": "12345"
 *     },
 *     {
 *       "id": "cat_456",
 *       "name": "Technology",
 *       "slug": "tech",
 *       "website_id": "12345"
 *     }
 *   ]
 * }
 *
 * @example
 * // Error response - Missing website ID (400)
 * {
 *   "message": "Website ID is required"
 * }
 *
 * @example
 * // Error response - Internal server error (500)
 * {
 *   "message": "Internal server error"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { fetchAllCategoriesPerSiteWorkflow } from "../../../../../../workflows/website/website-page/fetch-all-categories-per-site";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: websiteId } = req.params; // id here is the websiteId

  if (!websiteId) {
    return res.status(400).json({ message: "Website ID is required" });
  }

  try {
    const workflow = fetchAllCategoriesPerSiteWorkflow(req.scope);
    const { result: categories } = await workflow.run({
      input: { websiteId: websiteId }, // Pass websiteId to the workflow
    });

    return res.status(200).json({ categories });
  } catch (error) {
    console.error("Error fetching blog categories by website ID:", error);
    // Consider more specific error handling based on workflow errors
    return res.status(500).json({ message: "Internal server error" });
  }
}
