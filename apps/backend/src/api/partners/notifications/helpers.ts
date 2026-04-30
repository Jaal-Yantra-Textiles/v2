import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

const LAST_SEEN_KEY = "notifications_last_seen_at"

export type ResolvedPartnerForNotifications = {
  id: string
  metadata: Record<string, any>
  /** ISO timestamp; never null — partners with no prior reads get epoch 0. */
  last_seen_at: string
}

export const resolvePartnerForNotifications = async (
  authContext: { actor_id?: string | null } | undefined,
  container: MedusaContainer,
): Promise<ResolvedPartnerForNotifications> => {
  const partner = await getPartnerFromAuthContext(authContext, container)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account",
    )
  }
  const metadata = (partner.metadata as Record<string, any>) ?? {}
  const last_seen_at =
    typeof metadata[LAST_SEEN_KEY] === "string"
      ? (metadata[LAST_SEEN_KEY] as string)
      : new Date(0).toISOString()
  return { id: partner.id, metadata, last_seen_at }
}

/**
 * Bumps `partner.metadata.notifications_last_seen_at` to `at` (default now).
 * Reads existing metadata first and merges to avoid clobbering other keys.
 *
 * Uses query.graph to refetch so we have an authoritative snapshot of
 * metadata in case the auth-context partner came from a stale cache.
 */
export const setPartnerNotificationsLastSeen = async (
  partnerId: string,
  container: MedusaContainer,
  at: Date = new Date(),
): Promise<string> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partners",
    fields: ["id", "metadata"],
    filters: { id: partnerId },
  })
  const existing = (data?.[0] as any)?.metadata ?? {}
  const ts = at.toISOString()

  const partnerService: any = container.resolve("partner")
  await partnerService.updatePartners({
    id: partnerId,
    metadata: { ...existing, [LAST_SEEN_KEY]: ts },
  })
  return ts
}
