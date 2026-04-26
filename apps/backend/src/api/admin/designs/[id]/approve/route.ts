import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { IEventBusModuleService } from "@medusajs/types";
import updateDesignWorkflow from "../../../../../workflows/designs/update-design";
import { createProductFromDesignWorkflow } from "../../../../../workflows/designs/create-product-from-design";
import designCustomerLink from "../../../../../links/design-customer-link";

/**
 * POST /admin/designs/:id/approve
 *
 * Approves a design: transitions status to "Approved" and creates the
 * real Medusa product/variant from the design.
 *
 * Response:
 * {
 *   design: object,
 *   product_id: string,
 *   variant_id: string,
 * }
 */
export async function POST(
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
): Promise<void> {
  try {
    const designId = req.params.id;
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any;

    // Fetch design with estimated_cost
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: ["id", "name", "estimated_cost"],
    });

    if (!designs || designs.length === 0) {
      res.status(404).json({ message: "Design not found" });
      return;
    }

    const design = designs[0];

    // Look up the customer linked to this design
    const { data: customerLinks } = await query.graph({
      entity: designCustomerLink.entryPoint,
      filters: { design_id: designId },
      fields: ["customer_id"],
    });

    const customerId = customerLinks?.[0]?.customer_id || "";

    // Transition design status to Approved
    const { result: updatedDesign, errors: updateErrors } =
      await updateDesignWorkflow(req.scope).run({
        input: {
          id: designId,
          status: "Approved",
        },
      });

    if (updateErrors && updateErrors.length > 0) {
      console.error("[Admin] Error updating design status:", updateErrors);
      res.status(500).json({
        message: "Failed to update design status",
        errors: updateErrors,
      });
      return;
    }

    // Create real product/variant from design
    const { result: productResult, errors: productErrors } =
      await createProductFromDesignWorkflow(req.scope).run({
        input: {
          design_id: designId,
          estimated_cost: design.estimated_cost || 0,
          customer_id: customerId,
          currency_code: "usd",
        },
      });

    if (productErrors && productErrors.length > 0) {
      console.error("[Admin] Error creating product:", productErrors);
      res.status(500).json({
        message: "Failed to create product from design",
        errors: productErrors,
      });
      return;
    }

    // Emit design.approved so partners can be notified
    try {
      const eventBus = req.scope.resolve(Modules.EVENT_BUS) as IEventBusModuleService;
      await eventBus.emit({
        name: "design.approved",
        data: {
          design_id: designId,
          product_id: productResult.product_id,
          variant_id: productResult.variant_id,
        },
      });
    } catch {
      // Non-fatal — approval succeeded, notification is best-effort
    }

    res.status(200).json({
      design: updatedDesign,
      product_id: productResult.product_id,
      variant_id: productResult.variant_id,
    });
  } catch (error) {
    console.error("[Admin] Error in design approve:", error);
    res.status(500).json({
      message: "Failed to approve design",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
