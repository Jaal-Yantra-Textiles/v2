/**
 * One-shot seed: creates 2 inventory orders for the local test partner
 * so the partner-ui /inventory-orders list + detail pages have realistic
 * content for screenshots captured by web-jyt's /partner page tour.
 *
 * Not for production. Safe to run multiple times — every run creates new
 * orders (no idempotency key by design; we want a fresh fixture set).
 *
 * Run:
 *   cd apps/backend && npx medusa exec ./src/scripts/seed-partner-page-fixtures.ts
 */
import { ExecArgs } from "@medusajs/framework/types"
import { createInventoryOrderWorkflow } from "../workflows/inventory_orders/create-inventory-orders"
import { sendInventoryOrderToPartnerWorkflow } from "../workflows/inventory_orders/send-to-partner"

const PARTNER_ID = "01KPEYVFNR4VA13KMEJQWK7ZPX"
const STOCK_LOCATION_ID = "sloc_01KPSE6ZSSK78Z23Y927XNJ5NG"
const INVENTORY_ITEMS = [
  { id: "iitem_01KS9ADDJHTZK3A8YN1T4HEBDD", qty: 24, price: 4500, note: "Red Laal kurta — bridal commission" },
  { id: "iitem_01KS9BFPDM1QW59FGTM0N3CV6P", qty: 18, price: 4200, note: "Yellow Peela dupatta — same lot" },
  { id: "iitem_01KPTE06D23XVDY4YJYBW9WHSK", qty: 8,  price: 6800, note: "Default variant — limited run" },
]

export default async function seedPartnerPageFixtures({ container }: ExecArgs) {
  const today = new Date()
  const twoWeeks = new Date(today.getTime() + 14 * 86400_000)
  const oneWeek = new Date(today.getTime() + 7 * 86400_000)

  console.log("Seeding inventory order #1 (Processing)…")
  const order1 = await createInventoryOrderWorkflow(container).run({
    input: {
      quantity: INVENTORY_ITEMS.reduce((s, l) => s + l.qty, 0),
      total_price: INVENTORY_ITEMS.reduce((s, l) => s + l.qty * l.price, 0),
      status: "Pending",
      expected_delivery_date: twoWeeks,
      order_date: today,
      shipping_address: {
        company: "Cici Label · Studio",
        address_1: "12 Atelier Lane",
        city: "Mumbai",
        country_code: "in",
        postal_code: "400001",
      },
      stock_location_id: STOCK_LOCATION_ID,
      is_sample: false,
      order_lines: INVENTORY_ITEMS.map((i) => ({
        inventory_item_id: i.id,
        quantity: i.qty,
        price: i.price,
        metadata: { note: i.note },
      })),
      metadata: {
        po_reference: "PO-2026-04-AT",
        notes: "Bridal capsule — full handweave, no machine work.",
      },
    },
  })
  console.log(`   → ${order1.result.id} created`)

  await sendInventoryOrderToPartnerWorkflow(container).run({
    input: { inventoryOrderId: order1.result.id, partnerId: PARTNER_ID, adminNotes: "Sent to weaving partner." } as any,
  })
  console.log(`   → linked to partner ${PARTNER_ID}`)

  console.log("\nSeeding inventory order #2 (Shipped)…")
  const order2 = await createInventoryOrderWorkflow(container).run({
    input: {
      quantity: INVENTORY_ITEMS[0].qty,
      total_price: INVENTORY_ITEMS[0].qty * INVENTORY_ITEMS[0].price,
      status: "Pending",
      expected_delivery_date: oneWeek,
      order_date: new Date(today.getTime() - 18 * 86400_000),
      shipping_address: {
        company: "Le Atelier · Paris",
        address_1: "8 Rue de Sevigne",
        city: "Paris",
        country_code: "fr",
        postal_code: "75004",
      },
      stock_location_id: STOCK_LOCATION_ID,
      is_sample: false,
      order_lines: [
        {
          inventory_item_id: INVENTORY_ITEMS[0].id,
          quantity: INVENTORY_ITEMS[0].qty,
          price: INVENTORY_ITEMS[0].price,
          metadata: { note: "Prior run — already shipped" },
        },
      ],
      metadata: { po_reference: "PO-2026-03-PA" },
    },
  })
  console.log(`   → ${order2.result.id} created`)

  await sendInventoryOrderToPartnerWorkflow(container).run({
    input: { inventoryOrderId: order2.result.id, partnerId: PARTNER_ID, adminNotes: "Dispatched." } as any,
  })

  console.log("\n✓ seeded 2 inventory orders linked to partner", PARTNER_ID)
}
