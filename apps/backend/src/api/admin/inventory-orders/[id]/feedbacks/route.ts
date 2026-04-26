
/**
 * Routes: /admin/inventory-orders/[id]/feedbacks
 *
 * GET
 * @summary List all feedbacks linked to a specific inventory order
 * @param {string} id - Inventory order id (path parameter)
 * @returns {{ feedbacks: Feedback[]; count: number }} 200 - Array of feedbacks and total count
 * @throws 500 - Returns { message: string; error: string } on server error
 * @example
 * // curl
 * curl -X GET "https://example.com/admin/inventory-orders/ord_123/feedbacks" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json"
 *
 * @example
 * // fetch (node / browser)
 * await fetch("https://example.com/admin/inventory-orders/ord_123/feedbacks", {
 *   method: "GET",
 *   headers: { "Authorization": "Bearer <ADMIN_TOKEN>", "Content-Type": "application/json" },
 * }).then(res => res.json()).then(data => {
 *   // data.feedbacks -> Feedback[]
 *   // data.count -> number
 * });
 *
 * POST
 * @summary Create a new feedback and link it to the inventory order
 * @param {string} id - Inventory order id (path parameter)
 * @param {Feedback} body - Request body must conform to the Feedback validator used by the route
 * @returns {{ feedback: Feedback }} 201 - The created feedback object
 * @throws 500 - Returns { message: string; error: string } on server error
 * @remarks
 * The implementation will augment the provided body with a link_to.inventory_order_id
 * set to the path id before creating the feedback.
 * @example
 * // Request body example (must follow server-side Feedback validator)
 * {
 *   "title": "Damaged items",
 *   "message": "Some items arrived damaged",
 *   "severity": "high"
 * }
 *
 * @example
 * // curl
 * curl -X POST "https://example.com/admin/inventory-orders/ord_123/feedbacks" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "title": "Damaged items",
 *     "message": "Some items arrived damaged",
 *     "severity": "high"
 *   }'
 *
 * @example
 * // fetch (node / browser)
 * const res = await fetch("https://example.com/admin/inventory-orders/ord_123/feedbacks", {
 *   method: "POST",
 *   headers: { "Authorization": "Bearer <ADMIN_TOKEN>", "Content-Type": "application/json" },
 *   body: JSON.stringify({
 *     title: "Damaged items",
 *     message: "Some items arrived damaged",
 *     severity: "high"
 *   }),
 * });
 * const payload = await res.json();
 * // payload.feedback -> created Feedback
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createFeedbackWithLinkWorkflow } from "../../../../../workflows/feedback/create-feedback-with-link";
import { Feedback } from "../../../feedbacks/validators";

/**
 * GET /admin/inventory-orders/[id]/feedbacks
 * Lists all feedbacks linked to a specific inventory order
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const inventoryOrderId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  try {
    // Query all feedbacks linked to this inventory order
    const { data: orderData } = await query.index({
      entity: "inventory_orders",
      fields: ["feedbacks.*"],
      filters: {
        id: inventoryOrderId,
      },
    });

    // Extract the feedbacks from the inventory order object
    const feedbacks =
      orderData && orderData.length > 0 && orderData[0].feedbacks
        ? orderData[0].feedbacks
        : [];

    return res.json({
      feedbacks: feedbacks,
      count: feedbacks.length,
    });
  } catch (error) {
    console.error("Error fetching inventory order feedbacks:", error);
    return res.status(500).json({
      message: "Failed to fetch inventory order feedbacks",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * POST /admin/inventory-orders/[id]/feedbacks
 * Creates a new feedback and links it to the inventory order
 */
export const POST = async (
  req: MedusaRequest<Feedback>,
  res: MedusaResponse
) => {
  const inventoryOrderId = req.params.id;

  try {
    const { result } = await createFeedbackWithLinkWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        link_to: {
          inventory_order_id: inventoryOrderId,
        },
      },
    });

    return res.status(201).json({
      feedback: result.feedback,
    });
  } catch (error) {
    console.error("Error creating inventory order feedback:", error);
    return res.status(500).json({
      message: "Failed to create inventory order feedback",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
