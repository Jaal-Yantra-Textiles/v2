import {z} from 'zod'

export const subscriptionSchema = z.object({
    email: z.string().email(),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
  });


  export type SubscriptionSchema = z.infer<typeof subscriptionSchema>