import { z } from "zod"

export const registerDeviceTokenSchema = z.object({
  /**
   * The APNs device token (64 hex, iOS) or FCM registration token (Android).
   * Both rotate — the app re-registers on every launch where the token
   * changed, and the route upserts so rotation never duplicates.
   */
  token: z.string().min(16, "token looks too short to be a device token"),
  platform: z.enum(["ios", "android"]),
  app_version: z.string().max(40).optional(),
})

export const unregisterDeviceTokenSchema = z.object({
  token: z.string().min(16),
})

export type RegisterDeviceTokenInput = z.infer<typeof registerDeviceTokenSchema>
export type UnregisterDeviceTokenInput = z.infer<typeof unregisterDeviceTokenSchema>
