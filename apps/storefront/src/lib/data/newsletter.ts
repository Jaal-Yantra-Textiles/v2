"use server"

import { sdk } from "@lib/config"
import { getCacheOptions } from "./cookies"
import { PublicWebsite } from "./website"

/**
 * Subscribe a user to the website's newsletter via public Web API.
 * Backend validator requires: email, first_name, last_name, subscription_type, network, email_subscribed
 * Route: POST /web/website/:domain/subscribe
 */
export const subscribeToNewsletter = async (
  email: string,
  options?: {
    domain?: string
    first_name?: string
    last_name?: string
    subscription_type?: "email" | "sms"
    network?: "cicilabel" | "jaalyantra"
  }
) => {
  const domain = options?.domain || "shop.cicilabel.com"
  const first_name = options?.first_name || "Newsletter"
  const last_name = options?.last_name || "Subscriber"
  const subscription_type = options?.subscription_type || "email"
  const network = options?.network || "cicilabel"

  return sdk.client.fetch<{ message: string }>(`/web/website/${domain}/subscribe`, {
    method: "POST",
    body: {
      email,
      first_name,
      last_name,
      subscription_type,
      network,
      email_subscribed: email,
    },
    cache: "no-store",
  })
}