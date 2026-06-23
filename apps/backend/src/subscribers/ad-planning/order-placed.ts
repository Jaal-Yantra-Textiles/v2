/**
 * Order Placed Subscriber
 *
 * Tracks purchase conversions when orders are placed.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { trackPurchaseConversionWorkflow } from "../../workflows/ad-planning/conversions/track-purchase-conversion";

export default async function adPlanningOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  try {
    const orderId = data.id;

    if (!orderId) {
      logger.warn("[AdPlanning] Order placed event missing order ID");
      return;
    }

    // Run the purchase conversion tracking workflow
    await trackPurchaseConversionWorkflow(container).run({
      input: {
        order_id: orderId,
      },
    });

    logger.info(`[AdPlanning] Purchase conversion tracked for order: ${orderId}`);
  } catch (error) {
    logger.error("[AdPlanning] Failed to track purchase conversion:", error as Error);
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
