import type { MedusaContainer } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import { STOREFRONT_DESIGN_ASSISTANT_MODULE } from "../../modules/storefront-design-assistant"
import { verifyConversationAccessToken } from "./token"

/**
 * Access to saved storefront design conversations (#2543).
 *
 * A conversation is the whole chat transcript — every brief, email and image
 * URL the maker shared. It used to be readable by anyone who sent the maker's
 * email (`?customer_email=…`), i.e. by anyone who knew it. Now a caller must
 * present EITHER
 *
 *   1. the conversation token minted when the thread was created (guest path,
 *      kept in the maker's browser next to the thread), or
 *   2. an authenticated customer session whose email is the thread's email.
 *
 * An email on its own reads nothing.
 */

export type ConversationCredentials = {
  conversationToken?: string | null
  customerId?: string | null
}

/** The signed-in customer's normalised email, or null. */
export const sessionCustomerEmail = async (
  container: MedusaContainer,
  customerId: string | null | undefined
): Promise<string | null> => {
  if (!customerId) return null
  const customerService: any = container.resolve(Modules.CUSTOMER)
  const customer = await customerService
    .retrieveCustomer(customerId)
    .catch(() => null)
  const email = String(customer?.email ?? "").trim().toLowerCase()
  return email || null
}

/**
 * The conversation row when the caller may touch it, else null. "Not yours"
 * and "not there" are the same null — ids are not probeable.
 */
export const resolveConversationAccess = async (
  container: MedusaContainer,
  conversationId: string,
  credentials: ConversationCredentials
): Promise<any | null> => {
  const id = String(conversationId ?? "").trim()
  if (!id) return null

  const viaToken = verifyConversationAccessToken(credentials.conversationToken, id)
  const sessionEmail = viaToken
    ? null
    : await sessionCustomerEmail(container, credentials.customerId)
  if (!viaToken && !sessionEmail) return null

  const service: any = container.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  const [row] = await service
    .listStorefrontDesignConversations({ id })
    .catch(() => [])
  if (!row) return null
  if (viaToken) return row
  return row.customer_email === sessionEmail ? row : null
}

export const assertConversationAccess = async (
  container: MedusaContainer,
  conversationId: string,
  credentials: ConversationCredentials
): Promise<any> => {
  const row = await resolveConversationAccess(container, conversationId, credentials)
  if (!row) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Conversation ${conversationId} not found`
    )
  }
  return row
}
