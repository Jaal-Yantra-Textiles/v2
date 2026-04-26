import { type SubscriberConfig, type SubscriberArgs } from "@medusajs/framework"
import { geocodeAddressWorkflow } from "../workflows/persons/geocode-address"

export default async function handleAddressChange({ 
  event: { data },
  container
}: SubscriberArgs<{ id: string }>
){
  await geocodeAddressWorkflow(container).run({ input: { person_address_id: data.id } })
}

export const config: SubscriberConfig = {
  event: ["person_address.created", "person_address.updated"],
}
