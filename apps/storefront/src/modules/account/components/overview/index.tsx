import { Container } from "@medusajs/ui"

import ChevronDown from "@modules/common/icons/chevron-down"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import { Design } from "@lib/data/designs"
import OrderStatusTimeline from "@modules/order/components/order-status-timeline"

type OverviewProps = {
  customer: HttpTypes.StoreCustomer | null
  orders: HttpTypes.StoreOrder[] | null
  designs?: Design[]
}

// Design status → next action label
const DESIGN_STATUS_TASKS: Record<string, { label: string; done: boolean }[]> = {
  Conceptual: [
    { label: "Design submitted — awaiting review", done: true },
    { label: "Material selection in progress", done: false },
    { label: "Technical review pending", done: false },
  ],
  In_Development: [
    { label: "Design submitted", done: true },
    { label: "Material selection confirmed", done: true },
    { label: "In development — technical review in progress", done: false },
    { label: "Sample production pending", done: false },
  ],
  Technical_Review: [
    { label: "Design submitted", done: true },
    { label: "In development", done: true },
    { label: "Technical review underway", done: false },
    { label: "Sample production pending", done: false },
  ],
  Sample_Production: [
    { label: "Design approved for sampling", done: true },
    { label: "Sample production in progress", done: false },
    { label: "Review sample before full production", done: false },
  ],
  Revision: [
    { label: "Sample reviewed", done: true },
    { label: "Revision required — awaiting updated design", done: false },
  ],
  Approved: [
    { label: "Design approved", done: true },
    { label: "Ready for full production", done: false },
  ],
  Commerce_Ready: [
    { label: "Design approved", done: true },
    { label: "Production complete", done: true },
    { label: "Available for ordering", done: true },
  ],
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  Conceptual: "bg-gray-100 text-gray-700",
  In_Development: "bg-blue-100 text-blue-700",
  Technical_Review: "bg-yellow-100 text-yellow-700",
  Sample_Production: "bg-orange-100 text-orange-700",
  Revision: "bg-red-100 text-red-700",
  Approved: "bg-green-100 text-green-700",
  Commerce_Ready: "bg-emerald-100 text-emerald-700",
  On_Hold: "bg-gray-200 text-gray-500",
  Rejected: "bg-red-200 text-red-700",
}

const Overview = ({ customer, orders, designs }: OverviewProps) => {
  const recentOrders = orders?.slice(0, 3) || []
  const recentDesigns = designs?.slice(0, 3) || []

  return (
    <div data-testid="overview-page-wrapper">
      <div className="hidden small:block">
        <div className="text-xl-semi flex justify-between items-center mb-4">
          <span data-testid="welcome-message" data-value={customer?.first_name}>
            Hello {customer?.first_name}
          </span>
          <span className="text-small-regular text-ui-fg-base">
            Signed in as:{" "}
            <span
              className="font-semibold"
              data-testid="customer-email"
              data-value={customer?.email}
            >
              {customer?.email}
            </span>
          </span>
        </div>
        <div className="flex flex-col py-8 border-t border-gray-200">
          <div className="flex flex-col gap-y-4 h-full col-span-1 row-span-2 flex-1">
            {/* Profile + Address stats */}
            <div className="flex items-start gap-x-16 mb-6">
              <div className="flex flex-col gap-y-4">
                <h3 className="text-large-semi">Profile</h3>
                <div className="flex items-end gap-x-2">
                  <span
                    className="text-3xl-semi leading-none"
                    data-testid="customer-profile-completion"
                    data-value={getProfileCompletion(customer)}
                  >
                    {getProfileCompletion(customer)}%
                  </span>
                  <span className="uppercase text-base-regular text-ui-fg-subtle">
                    Completed
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-y-4">
                <h3 className="text-large-semi">Addresses</h3>
                <div className="flex items-end gap-x-2">
                  <span
                    className="text-3xl-semi leading-none"
                    data-testid="addresses-count"
                    data-value={customer?.addresses?.length || 0}
                  >
                    {customer?.addresses?.length || 0}
                  </span>
                  <span className="uppercase text-base-regular text-ui-fg-subtle">
                    Saved
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-y-4">
                <h3 className="text-large-semi">Designs</h3>
                <div className="flex items-end gap-x-2">
                  <span className="text-3xl-semi leading-none">
                    {designs?.length || 0}
                  </span>
                  <span className="uppercase text-base-regular text-ui-fg-subtle">
                    Created
                  </span>
                </div>
              </div>
            </div>

            {/* Recent Designs + tasks */}
            {recentDesigns.length > 0 && (
              <div className="flex flex-col gap-y-4 mb-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-large-semi">My Designs</h3>
                  <LocalizedClientLink
                    href="/account/designs"
                    className="text-small-regular text-ui-fg-subtle hover:text-ui-fg-base underline"
                  >
                    View all
                  </LocalizedClientLink>
                </div>
                <ul className="flex flex-col gap-y-4">
                  {recentDesigns.map((design) => {
                    const tasks = DESIGN_STATUS_TASKS[design.status || "Conceptual"] || []
                    const statusColor = STATUS_BADGE_COLORS[design.status || "Conceptual"] || "bg-gray-100 text-gray-700"
                    return (
                      <li key={design.id}>
                        <Container className="bg-gray-50 p-4 flex flex-col gap-y-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-x-3">
                              {design.thumbnail_url && (
                                <img
                                  src={design.thumbnail_url}
                                  alt={design.name}
                                  className="w-12 h-12 object-cover rounded-lg border border-gray-200"
                                />
                              )}
                              <div>
                                <p className="font-semibold text-sm text-gray-900">{design.name}</p>
                                <p className="text-xs text-gray-500">
                                  {design.created_at
                                    ? new Date(design.created_at).toLocaleDateString()
                                    : "—"}
                                </p>
                                {(design.inventory_items?.length ?? 0) > 0 && (
                                  <p className="text-xs text-gray-400 mt-0.5">
                                    {design.inventory_items!.map((i) => i.title).filter(Boolean).join(", ")}
                                  </p>
                                )}
                              </div>
                            </div>
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>
                              {design.status?.replace(/_/g, " ") || "Conceptual"}
                            </span>
                          </div>

                          {/* Task checklist */}
                          {tasks.length > 0 && (
                            <ul className="flex flex-col gap-y-1 pl-1">
                              {tasks.map((task, i) => (
                                <li key={i} className="flex items-center gap-x-2 text-xs">
                                  <span
                                    className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                                      task.done
                                        ? "bg-green-100 text-green-600"
                                        : "bg-gray-200 text-gray-400"
                                    }`}
                                  >
                                    {task.done ? "✓" : "○"}
                                  </span>
                                  <span className={task.done ? "text-gray-400 line-through" : "text-gray-700"}>
                                    {task.label}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </Container>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {/* Recent Orders + tasks */}
            <div className="flex flex-col gap-y-4">
              <div className="flex items-center gap-x-2">
                <h3 className="text-large-semi">Recent orders</h3>
              </div>
              <ul
                className="flex flex-col gap-y-4"
                data-testid="orders-wrapper"
              >
                {recentOrders.length > 0 ? (
                  recentOrders.map((order) => {
                    return (
                      <li
                        key={order.id}
                        data-testid="order-wrapper"
                        data-value={order.id}
                      >
                        <Container className="bg-gray-50 p-4 flex flex-col gap-y-3">
                          <LocalizedClientLink
                            href={`/account/orders/details/${order.id}`}
                          >
                            <div className="flex justify-between items-center">
                              <div className="grid grid-cols-3 text-small-regular gap-x-4 flex-1">
                                <span className="font-semibold">Date placed</span>
                                <span className="font-semibold">Order number</span>
                                <span className="font-semibold">Total amount</span>
                                <span data-testid="order-created-date">
                                  {new Date(order.created_at).toDateString()}
                                </span>
                                <span
                                  data-testid="order-id"
                                  data-value={order.display_id}
                                >
                                  #{order.display_id}
                                </span>
                                <span data-testid="order-amount">
                                  {convertToLocale({
                                    amount: order.total,
                                    currency_code: order.currency_code,
                                  })}
                                </span>
                              </div>
                              <button className="flex items-center justify-between" data-testid="open-order-button">
                                <span className="sr-only">Go to order #{order.display_id}</span>
                                <ChevronDown className="-rotate-90" />
                              </button>
                            </div>
                          </LocalizedClientLink>

                          <OrderStatusTimeline order={order} variant="compact" />
                        </Container>
                      </li>
                    )
                  })
                ) : (
                  <span data-testid="no-orders-message">No recent orders</span>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const getProfileCompletion = (customer: HttpTypes.StoreCustomer | null) => {
  let count = 0

  if (!customer) {
    return 0
  }

  if (customer.email) {
    count++
  }

  if (customer.first_name && customer.last_name) {
    count++
  }

  if (customer.phone) {
    count++
  }

  const billingAddress = customer.addresses?.find(
    (addr) => addr.is_default_billing
  )

  if (billingAddress) {
    count++
  }

  return (count / 4) * 100
}

export default Overview
