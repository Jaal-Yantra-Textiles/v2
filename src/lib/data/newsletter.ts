"use server"

import { sdk } from "@lib/config"

export const subscribeToNewsletter = async (email: string) => {
  const response = await sdk.client.fetch(`/store/newsletter`, {
    method: "POST",
    body: {
      email,
    },
  })

  return response
}