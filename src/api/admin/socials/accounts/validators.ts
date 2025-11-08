import { z } from "zod"

/**
 * Schema for getting managed accounts
 */
export const GetAccountsSchema = z.object({
  userAccessToken: z.string().min(1, "User access token is required"),
})

export type GetAccountsRequest = z.infer<typeof GetAccountsSchema>
