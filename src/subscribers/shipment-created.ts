import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"

export default async function shipmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  id: string,
  no_notification: boolean
}>) {
  // TODO handle event
}

export const config: SubscriberConfig = {
  event: "shipment.created",
}