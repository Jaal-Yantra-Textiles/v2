/**
 * POST /admin/designs/auto
 *
 * Summary:
 *   Create a design using the LLM-driven workflow. The endpoint invokes the
 *   createDesignFromLLMWorkflow using the current request scope and the
 *   validated request body, then returns the freshly refetched design.
 *
 * Request:
 *   - Content-Type: application/json
 *   - Body: CreateDesignLLM (see ../validators). The body is validated with zod.
 *
 * Typical fields (refer to CreateDesignLLM for exact schema):
 *   - prompt: string               // natural-language prompt for the LLM
 *   - style?: string               // optional style or preset id
 *   - images?: string[]            // optional image URLs to condition generation
 *   - dimensions?: { width:number, height:number }
 *   - metadata?: Record<string, any>
 *
 * Responses:
 *   201 Created
 *     {
 *       "design": { /* complete design object (refetched) *\/ }
 *     }
 *
 *   400 Bad Request
 *     Invalid request body / validation failed (handled by Medusa validation middleware)
 *
 *   422 Unprocessable Entity
 *     Workflow reported domain-level errors (returned as thrown errors)
 *
 *   500 Internal Server Error
 *     Unexpected server error
 *
 * Behavior & error handling:
 *   - The route runs the createDesignFromLLMWorkflow with req.scope.
 *   - If the workflow returns any errors, they are logged and thrown.
 *   - On success the route refetches the design (with full relations) and
 *     returns it with HTTP 201.
 *
 * Curl example:
 *   curl -X POST "https://api.example.com/admin/designs/auto" \
 *     -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "prompt": "Repeatable floral pattern, teal and coral, mid-century vibe",
 *       "style": "textile-basic",
 *       "dimensions": { "width": 2048, "height": 2048 },
 *       "metadata": { "collection": "summer-24", "priority": "high" }
 *     }'
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import createDesignFromLLMWorkflow from "../../../../workflows/designs/create-design-from-llm";
import { refetchDesign } from "../helpers";
import { CreateDesignLLM } from "../validators";

export const POST = async (
    req: MedusaRequest<CreateDesignLLM>,
    res: MedusaResponse,
) => {
    const { result, errors } = await createDesignFromLLMWorkflow(req.scope).run({
        input: req.validatedBody,
    });

    if (errors.length > 0) {
        console.warn("Error reported at", errors);
        throw errors;
    }

    const design = await refetchDesign(
        result.id,
        req.scope,
        ['*']
    );

    

    res.status(201).json({ design });
}
  
