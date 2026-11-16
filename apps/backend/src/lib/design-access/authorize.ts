import type { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import designCustomerLink from "../../links/design-customer-link"
import { verifyDesignAccessToken } from "./token"

/**
 * The single ownership check for the storefront design chat (#2543).
 *
 * Every design-scoped action — chat tools (generate_design_image,
 * set_active_canvas, get_design_state, save_moodboard, create_design on an
 * existing design) and the design-assistant routes (pick, board read,
 * references, conversations) — goes through `resolveDesignAccess`. A caller is
 * allowed when it presents EITHER
 *
 *   1. a valid design access token minted for THAT design (the guest path), or
 *   2. an authenticated customer session linked to the design (design↔customer
 *      link — the registered-account path).
 *
 * A bare design id or a bare email grants nothing.
 *
 * 🔑 Denials do not distinguish "not yours" from "not there": the check runs
 * BEFORE any existence lookup, so a design id is not an oracle.
 */

export const DESIGN_ACCESS_DENIED_CODE = "design_access_denied"
export const DESIGN_ACCESS_DENIED_MESSAGE =
  "This design belongs to another session. Start a new design, or reopen it from the browser that created it."

export const DESIGN_TOKEN_HEADER = "x-design-token"
export const CONVERSATION_TOKEN_HEADER = "x-conversation-token"

export type DesignAccessCredentials = {
  /** Capability token from the client (header / request context). */
  token?: string | null
  /** Authenticated customer actor id, if the request carries a session. */
  customerId?: string | null
}

export type DesignAccessGrant = {
  via: "token" | "customer"
  /** The customer the design belongs to (token claim or session actor). */
  customer_id: string | null
}

export const resolveDesignAccess = async (
  container: MedusaContainer,
  designId: string | null | undefined,
  credentials: DesignAccessCredentials | undefined
): Promise<DesignAccessGrant | null> => {
  const id = String(designId ?? "").trim()
  if (!id) return null

  const claims = verifyDesignAccessToken(credentials?.token, id)
  if (claims) return { via: "token", customer_id: claims.customer_id }

  const customerId = credentials?.customerId
  if (customerId) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: links = [] } = await query
      .graph({
        entity: designCustomerLink.entryPoint,
        fields: ["design_id", "customer_id"],
        filters: { design_id: id, customer_id: customerId },
      })
      .catch(() => ({ data: [] }))
    // An empty relation can come back as one all-null row — check the value.
    if ((links as any[]).some((l) => l?.design_id === id)) {
      return { via: "customer", customer_id: customerId }
    }
  }

  return null
}

export class DesignAccessDeniedError extends MedusaError {
  constructor() {
    super(
      MedusaError.Types.FORBIDDEN,
      DESIGN_ACCESS_DENIED_MESSAGE,
      DESIGN_ACCESS_DENIED_CODE
    )
  }
}

/** Throwing form — 403 through Medusa's error handler. */
export const assertDesignAccess = async (
  container: MedusaContainer,
  designId: string | null | undefined,
  credentials: DesignAccessCredentials | undefined
): Promise<DesignAccessGrant> => {
  const grant = await resolveDesignAccess(container, designId, credentials)
  if (!grant) throw new DesignAccessDeniedError()
  return grant
}

const headerValue = (req: any, name: string): string | null => {
  const raw = req?.headers?.[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * Credentials carried by an HTTP request: the `x-design-token` header (or a
 * `design_token` body field, for multipart uploads) and the customer session
 * actor when `authenticate(..., { allowUnauthenticated: true })` ran.
 *
 * Never read from the query string — tokens in URLs end up in access logs.
 */
export const readDesignCredentials = (req: any): DesignAccessCredentials => {
  const bodyToken =
    req?.body && typeof req.body === "object" && typeof req.body.design_token === "string"
      ? req.body.design_token.trim()
      : null
  const actorType = req?.auth_context?.actor_type
  const actorId = req?.auth_context?.actor_id
  return {
    token: headerValue(req, DESIGN_TOKEN_HEADER) ?? (bodyToken || null),
    customerId: actorType === "customer" && actorId ? String(actorId) : null,
  }
}

export const readConversationToken = (req: any): string | null =>
  headerValue(req, CONVERSATION_TOKEN_HEADER)
