/**
 * @file Admin → partner read-proxy primitive (#843, approach #2).
 * @description Lets admin-side inspection routes read a partner's operational
 *   internals *as the partner sees them*, by reusing the partner portal's own
 *   scoping helpers (`src/api/partners/helpers.ts`) instead of re-deriving the
 *   scoping rules admin-side — which is how the two surfaces drift apart.
 * @module API/Admin/Partners/Inspection
 */
import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { tryGetPartnerStore } from "../../../../partners/helpers"

/**
 * The shape `src/api/partners/helpers.ts` reads off `req.auth_context`.
 *
 * Every partner-portal ownership helper (`getPartnerFromAuthContext`,
 * `getPartnerStore`, `tryGetPartnerSalesChannelId`, `validatePartnerOrderOwnership`,
 * …) keys off `actor_id` == the partner id and nothing else, so an admin route
 * can hand them a synthesized context and transparently inherit the entire
 * partner scoping chain.
 *
 * `actor_type`/`app_metadata` are set for parity with a genuine partner bearer
 * (and so anything logging the context reads sensibly) — they are not what the
 * helpers dispatch on.
 */
export type SynthesizedPartnerAuthContext = {
  actor_id: string
  actor_type: "partner"
  app_metadata: { partner_id: string }
}

/**
 * READ-ONLY BY CONSTRUCTION — deliberately.
 *
 * This mints a plain object, never a bearer token, and is only ever passed to
 * partner *read* helpers from `GET` handlers. It is NOT impersonation: nothing
 * here can authenticate a request, so it cannot be replayed or leaked as a
 * credential. The audited act-as-partner token (approach #1 on #843) is a
 * separate, later, RBAC-gated thing — do not grow this into it.
 */
export const synthesizePartnerAuthContext = (
  partnerId: string
): SynthesizedPartnerAuthContext => ({
  actor_id: partnerId,
  actor_type: "partner",
  app_metadata: { partner_id: partnerId },
})

/**
 * Assert the partner exists before proxying, and return it.
 *
 * Without this the partner helpers would surface a partner-voiced
 * `UNAUTHORIZED "No partner associated with this account"` for an unknown id,
 * which is both the wrong status and a nonsense message for an admin caller.
 * Mirrors the 404 the sibling admin partner sub-routes throw.
 */
export const assertPartnerExists = async (
  partnerId: string,
  container: MedusaContainer
): Promise<{ id: string; name?: string }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partner",
    fields: ["id", "name"],
    filters: { id: partnerId },
  })

  const partner = data?.[0] as { id: string; name?: string } | undefined
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  return partner
}

/**
 * Which of the partner's stores an inspection route should read.
 *
 * Defaults to the partner's first store — the one the partner portal itself
 * lands on — via the portal's own helper. An explicit `store_id` is checked
 * against the partner's stores HERE so a foreign id reads as a 404 to an admin,
 * instead of the partner-voiced `UNAUTHORIZED "Store … is not associated with
 * this partner"` the downstream partner code would throw. Same reason
 * `assertPartnerExists` exists.
 *
 * Returns `storeId: null` for a partner that has never provisioned a store:
 * that is a normal state an operator wants to see (it is what the onboarding
 * flow exists to fix), not an error (#1158).
 */
export const resolvePartnerInspectionStoreId = async (
  authContext: SynthesizedPartnerAuthContext,
  container: MedusaContainer,
  requestedStoreId?: string
): Promise<{ partner: any; storeId: string | null }> => {
  const { partner, store } = await tryGetPartnerStore(authContext, container)

  if (!requestedStoreId) {
    return { partner, storeId: store?.id ?? null }
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.id"],
    filters: { id: partner.id },
  })

  const stores = ((data?.[0] as any)?.stores || []) as Array<{ id: string }>
  if (!stores.some((s) => s.id === requestedStoreId)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Store not found for this partner"
    )
  }

  return { partner, storeId: requestedStoreId }
}

/**
 * The two together: 404 on an unknown partner, otherwise the synthesized
 * context the partner helpers expect.
 */
export const resolvePartnerInspectionContext = async (
  partnerId: string,
  container: MedusaContainer
): Promise<{
  partner: { id: string; name?: string }
  authContext: SynthesizedPartnerAuthContext
}> => {
  const partner = await assertPartnerExists(partnerId, container)
  return { partner, authContext: synthesizePartnerAuthContext(partner.id) }
}
