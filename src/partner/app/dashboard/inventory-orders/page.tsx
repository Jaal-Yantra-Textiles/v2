import { Container, Heading, Text } from "@medusajs/ui"
import { getPartnerInventoryOrders } from "../actions"
import OrdersTable, { PartnerOrderRow } from "./orders-table"

export const dynamic = "force-dynamic"

export default async function InventoryOrdersPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const sp = (await searchParams) || {}
  const page = Number(sp.page || 1)
  const limit = 20
  const offset = (page - 1) * limit

  const res = await getPartnerInventoryOrders({ limit, offset })
  const orders = res?.inventory_orders || []
  const count = res?.count || 0
  // Pagination UI handled by data table; total pages can be computed there if needed

  return (
    <Container className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <Heading level="h2">All Orders</Heading>
        <Text size="small" className="text-ui-fg-subtle">{count} total</Text>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-md border-ui-border-base p-8 text-center">
          <Text>No inventory orders assigned yet.</Text>
        </div>
      ) : (
        <OrdersTable data={orders as PartnerOrderRow[]} count={count} />
      )}

      {/* Pagination controls are handled by DataTable's pagination UI */}
    </Container>
  )
}
