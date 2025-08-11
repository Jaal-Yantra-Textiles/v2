import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";

export default async function subscriptionCreatedHandler({
    event: { data },
    container,
}: SubscriberArgs<{ id: string }>) {
    
}


export const config: SubscriberConfig = {
    event: "subscription.created",
  };
