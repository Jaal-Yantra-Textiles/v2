import {z} from "zod"
import { Network, SubscriptionType } from '../../../../workflows/persons/create-person-subs';

export const subscriptionSchema = z.object({
    email: z.string().email(),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    subscription_type: z.nativeEnum(SubscriptionType),
    network: z.nativeEnum(Network),
    email_subscribed: z.string().email(),
  });


  export type SubscriptionSchema = z.infer<typeof subscriptionSchema>