/**
 * GET /admin/inventory-orders/:id/shiprocket-rates
 *
 * List Shiprocket courier options (rate / ETA / recommended) for an inventory
 * order's stock-movement shipment, so the admin can pick a courier before
 * creating the shipment. Mirrors the partner route; origin = from-location
 * pickup, destination = to-location. Optional
 * `?weight_grams=&length=&breadth=&height=` refine the quote.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getShiprocketRatesForInventoryOrder } from "../../../../../workflows/inventory_orders/shiprocket-rates";

const num = (v: unknown): number | undefined => {
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id;

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
};
