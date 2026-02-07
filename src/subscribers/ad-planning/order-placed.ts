/**
 * Order Placed Subscriber
 *
 * Tracks purchase conversions when orders are placed.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { trackPurchaseConversionWorkflow } from "../../workflows/ad-planning/conversions/track-purchase-conversion";

export default async function adPlanningOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const orderId = data.id;

    if (!orderId) {
      console.warn("[AdPlanning] Order placed event missing order ID");
      return;
    }

    // Run the purchase conversion tracking workflow
    await trackPurchaseConversionWorkflow(container).run({
      input: {
        order_id: orderId,
      },
    });

    console.log(`[AdPlanning] Purchase conversion tracked for order: ${orderId}`);
  } catch (error) {
    console.error("[AdPlanning] Failed to track purchase conversion:", error);
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
