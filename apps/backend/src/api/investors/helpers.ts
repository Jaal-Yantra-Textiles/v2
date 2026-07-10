import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export const refetchInvestor = async (
  investorId: string,
  container: MedusaContainer
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const result = await query.graph({
    entity: "investors",
    filters: { id: investorId },
    fields: [
      "*",
      "admins.id", "admins.first_name", "admins.last_name", "admins.email",
      "admins.phone", "admins.role", "admins.permissions", "admins.metadata",
      "admins.preferred_language", "admins.is_active", "admins.last_login",
      "admins.created_at", "admins.updated_at",
    ],
  })
  return (result.data || [])[0]
}

export const getInvestorFromAuthContext = async (
  authContext: { actor_id?: string | null } | undefined,
  container: MedusaContainer
): Promise<any | null> => {
  const investorId = authContext?.actor_id
  if (!investorId) return null
  const investor = await refetchInvestor(investorId, container)
  return investor || null
}

export const requireInvestor = async (
  authContext: { actor_id?: string | null } | undefined,
  container: MedusaContainer
): Promise<any> => {
  const investor = await getInvestorFromAuthContext(authContext, container)
  if (!investor) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No investor associated with this account"
    )
  }
  return investor
}

export const refetchCapTable = async (
  capTableId: string,
  container: MedusaContainer
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const result = await query.graph({
    entity: "cap_tables",
    filters: { id: capTableId },
    fields: [
      "*",
      "share_classes.*",
      "stakes.*",
      "funding_rounds.*",
      "calls_for_shares.*",
      "documents.*",
    ],
  })
  return (result.data || [])[0]
}
