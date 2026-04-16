"use server"

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { getCacheOptions } from "./cookies"

export const retrieveCollection = async (id: string) => {
  const next = {
    ...(await getCacheOptions("collections")),
  }

  return sdk.client
    .fetch<{ collection: HttpTypes.StoreCollection }>(
      `/store/collections/${id}`,
      {
        next,
        cache: "force-cache",
      }
    )
    .then(({ collection }) => collection)
}

export const listCollections = async (
  queryParams: Record<string, string> = {}
): Promise<{ collections: HttpTypes.StoreCollection[]; count: number }> => {
  const next = {
    ...(await getCacheOptions("collections")),
  }

  return sdk.client
    .fetch<{ collections: HttpTypes.StoreCollection[]; count: number }>(
      "/store/collections",
      {
        next,
        cache: "force-cache",
      }
    )
    .then(({ collections, count }) => ({ collections, count }))
}

export const getCollectionByHandle = async (
  handle: string
): Promise<HttpTypes.StoreCollection> => {
  const next = {
    ...(await getCacheOptions("collections")),
  }

  return sdk.client
    .fetch<{ collections: HttpTypes.StoreCollection[] }>(
      "/store/collections",
      {
        next,
        cache: "force-cache",
      }
    )
    .then(({ collections }) => collections.find((c) => c.handle === handle)!)
}
