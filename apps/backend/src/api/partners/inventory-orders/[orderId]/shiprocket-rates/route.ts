/**
 * @route GET /partners/inventory-orders/:orderId/shiprocket-rates
 * @scope partner
 *
 * List Shiprocket courier options (rate / ETA / recommended) for the order's
 * stock-movement shipment, so the partner can CHOOSE a courier before creating
 * the shipment (else Shiprocket auto-assigns). Origin = the order's
 * from-location (its registered pickup's pincode, else its own address
 * pincode — never another party's warehouse); destination = the to-location
 * pincode. Optional `?weight_grams=&length=&breadth=&height=` refine the quote.
 *
 * The acting partner must own the order (IDOR guard, #778 C1).
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import {
  getPartnerFromAuthContext,
  assertPartnerOwnsInventoryOrder,
} from "../../../helpers";
import { getShiprocketRatesForInventoryOrder } from "../../../../../workflows/inventory_orders/shiprocket-rates";

const num = (v: unknown): number | undefined => {
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const orderId = req.params.orderId;

  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ error: "Partner authentication required" });
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" });
  }
  await assertPartnerOwnsInventoryOrder(req.scope, orderId, partner.id);

  const length = num(req.query.length);
  const breadth = num(req.query.breadth);
  const height = num(req.query.height);
  const dimensionsCm =
    length || breadth || height ? { length, breadth, height } : undefined;

  const result = await getShiprocketRatesForInventoryOrder(req.scope, {
    orderId,
    weightGrams: num(req.query.weight_grams),
    dimensionsCm,
  });

  res.status(200).json(result);
}
