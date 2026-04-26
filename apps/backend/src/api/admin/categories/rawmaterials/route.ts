
/**
 * Route: /admin/categories/rawmaterials
 * File: src/api/admin/categories/rawmaterials/route.ts
 *
 * Exports two HTTP handlers for managing raw material categories in the admin API:
 * - GET: list raw material categories with filtering, sorting and pagination
 * - POST: create a new raw material category
 *
 * Both handlers use Medusa-style request/response objects (MedusaRequest, MedusaResponse)
 * and rely on application workflows:
 * - listRawMaterialCategoriesWorkflow(req.scope).run({ input: { ... } })
 * - createRawMaterialCategoryWorkflow(req.scope).run({ input: { ... } })
 *
 * Behavior summary
 * - GET:
 *   - Accepts validated query parameters (ReadRawMaterialCategoriesType) with keys:
 *     - filters?: Record<string, any>         // filter criteria passed to the workflow
 *     - config?: Record<string, any>          // arbitrary DB/config options passed to the workflow
 *     - page?: number = 1                     // 1-based page index
 *     - limit?: number = 10                   // items per page
 *   - Converts pagination into workflow-friendly form:
 *     - skip = (page - 1) * limit
 *     - take = limit
 *     - passes { filters, config: { ...config, skip, take } } to the workflow
 *   - On success returns HTTP 200 with payload:
 *     {
 *       categories: Array<object>,   // list of category DTOs returned by workflow
 *       count: number,               // total number of matching items
 *       page: number,                // requested page
 *       limit: number,               // requested limit
 *       offset: number,              // equivalent to skip
 *       pagination: {
 *         page: number,
 *         pageCount: number,         // Math.ceil(count / limit)
 *         pageSize: number,          // same as limit
 *         numItems: number           // same as count
 *       }
 *     }
 *   - On workflow-reported errors or exceptions returns HTTP 400 with { error: string }.
 *
 * - POST:
 *   - Accepts a validated request body (CreateMaterialTypeType)
 *     containing the properties required to create a raw material category.
 *   - Calls createRawMaterialCategoryWorkflow(req.scope).run({ input: validatedBody })
 *   - On success returns HTTP 200 with the workflow result (created category object).
 *   - If the workflow returns errors, responds HTTP 400 with { error: errors[0] }.
 *
 * Error handling and logging
 * - If the workflow returns an errors array with length > 0, handlers log a warning
 *   via console.warn("Error reported at", errors) and return a 400 response.
 * - GET additionally throws errors caught by the try/catch block and returns error.message.
 *
 * Examples
 *
 * Example: GET list with page/limit and filters (cURL)
 * curl -G "https://api.example.com/admin/categories/rawmaterials" \
 *   --data-urlencode "page=2" \
 *   --data-urlencode "limit=25" \
 *   --data-urlencode "filters[name]=steel" \
 *   -H "Authorization: Bearer <admin-token>"
 *
 * Example GET response (200)
 * {
 *   "categories": [
 *     { "id": "cat_01", "name": "Steel", "metadata": {} },
 *     { "id": "cat_02", "name": "Alloy Steel", "metadata": {} }
 *   ],
 *   "count": 42,
 *   "page": 2,
 *   "limit": 25,
 *   "offset": 25,
 *   "pagination": {
 *     "page": 2,
 *     "pageCount": 2,
 *     "pageSize": 25,
 *     "numItems": 42
 *   }
 * }
 *
 * Example: POST create a new raw material category (cURL)
 * curl "https://api.example.com/admin/categories/rawmaterials" \
 *   -X POST \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer <admin-token>" \
 *   -d '{
 *     "name": "Composite Materials",
 *     "description": "Categories for composite raw materials",
 *     "metadata": { "source": "internal" }
 *   }'
 *
 * Example POST response (200)
 * {
 *   "id": "cat_123",
 *   "name": "Composite Materials",
 *   "description": "Categories for composite raw materials",
 *   "metadata": { "source": "internal" },
 *   "created_at": "2024-12-01T12:34:56.000Z"
 * }
 *
 * Notes and recommendations
 * - The GET handler expects the client to provide page and limit as positive integers.
 *   If omitted, defaults are page=1 and limit=10.
 * - The GET handler exposes both an explicit "offset" field (skip) and a "pagination" block
 *   for convenience. pageCount is computed with Math.ceil(count / limit); if count is 0, pageCount is 0.
 * - Workflow responses are returned directly; ensure workflows return sanitized DTOs suitable for API exposure.
 *
 * @module admin/raw-material-categories-route
 * @see listRawMaterialCategoriesWorkflow
 * @see createRawMaterialCategoryWorkflow
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { listRawMaterialCategoriesWorkflow } from "../../../../workflows/raw-materials/list-raw-material-category";
import { CreateMaterialTypeType, ReadRawMaterialCategoriesType } from "./validators";
import { createRawMaterialCategoryWorkflow } from "../../../../workflows/raw-materials/create-raw-material-category";

export const GET = async (
  req: MedusaRequest<{}, ReadRawMaterialCategoriesType>,
  res: MedusaResponse
) => {
  try {
    // Extract validated query parameters 
    const { filters = {}, config = {}, page = 1, limit = 10 } = req.validatedQuery;

    // Transform pagination params to match the workflow input format
    const skip = (page - 1) * limit;
    
    // Call the workflow with properly formatted input
    const { result, errors } = await listRawMaterialCategoriesWorkflow(req.scope).run({
      input: {
        filters,
        config: {
          ...config,
          skip,
          take: limit
        }
      },
    });


    if (errors && errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const { categories, count } = result;

    // Return the result with pagination metadata
    res.status(200).json({
      categories,
      count,
      page,
      limit,
      offset: skip,
      // Add pagination metadata
      pagination: {
        page,
        pageCount: Math.ceil(count / limit),
        pageSize: limit,
        numItems: count
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};


export const POST = async (
  req: MedusaRequest<CreateMaterialTypeType>,
  res: MedusaResponse
) => {


  const { result, errors } = await createRawMaterialCategoryWorkflow(req.scope).run({
    input: {
      ...req.validatedBody
    },
  });

  if (errors && errors.length > 0) {
    console.warn("Error reported at", errors);
    return res.status(400).json({ error: errors[0] });
  }

  res.status(200).json(result);
};
