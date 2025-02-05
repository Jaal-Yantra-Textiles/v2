import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";

export default async function taskAssignedHandler({
    event: { data },
    container,
}: SubscriberArgs<{ id: string }>) {
    
}


export const config: SubscriberConfig = {
    event: "task_assigned",
  };
  