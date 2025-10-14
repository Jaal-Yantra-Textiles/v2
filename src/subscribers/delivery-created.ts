import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"

export default async function deliveryCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  id: string
}>) {
  // TODO handle event
}

export const config: SubscriberConfig = {
  event: "delivery.created",
}