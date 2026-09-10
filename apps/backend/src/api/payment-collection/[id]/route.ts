/**
 * GET /payment-collection/:id — the URL the admin's "Copy payment link" button
 * builds (#1985).
 *
 * The button is core dashboard code we do not own:
 *
 *   `${MEDUSA_STOREFRONT_URL}/payment-collection/${collection.id}?order_id=${order.id}`
 *
 * We cannot change the shape of that string, only where it points. Setting
 * `admin.storefrontUrl` to this backend makes the copied link land here, and
 * this route forwards to the hosted Stripe page that actually collects the
 * money. That keeps the fix to one config value plus one redirect, with no
 * patched dashboard component and no page duplicated across two storefront
 * apps.
 *
 * `order_id` rides along in the query string and is deliberately ignored: the
 * collection id alone identifies what is owed, and trusting an order id from a
 * URL would let one link ask about another order's money.
 *
 * A 302 rather than rendering here, so there is exactly ONE payment page to
 * maintain and the buyer's address bar shows the page they are actually on.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * PURE: the hosted page a collection link forwards to.
 *
 * Rejects anything that is not a plain id — the value arrives from a URL, and a
 * path segment is being built from it. Returns null when it is unusable so the
 * caller 404s instead of emitting a `Location` header an attacker chose.
 * Exported for unit testing.
 */
export function collectionPayPath(id: unknown): string | null {
  const raw = typeof id === "string" ? id.trim() : ""
  if (!raw || !/^[A-Za-z0-9_-]{1,128}$/.test(raw)) {
    return null
  }
  return `/stripe/pay/collection/${raw}`
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const path = collectionPayPath(req.params.id)

  if (!path) {
    res.status(404)
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.send(
      "<!doctype html><meta charset=utf-8><title>Payment link</title>" +
        "<p>This payment link is not valid.</p>"
    )
    return
  }

  res.redirect(302, path)
}
