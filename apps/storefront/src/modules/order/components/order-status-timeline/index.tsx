import { HttpTypes } from "@medusajs/types"

type OrderStatusTimelineProps = {
  order: HttpTypes.StoreOrder
  /** Compact mode for cards/overview, full mode for detail page */
  variant?: "compact" | "full"
}

type Task = {
  label: string
  done: boolean
  timestamp?: string | null
}

function getOrderTimeline(order: HttpTypes.StoreOrder): Task[] {
  const tasks: Task[] = []
  const status = order.status
  const paymentStatus = (order as any).payment_status
  const fulfillmentStatus = (order as any).fulfillment_status
  const fulfillments: any[] = (order as any).fulfillments || []

  // Find the most advanced fulfillment
  const latestFulfillment = fulfillments[0]

  // 1. Order placed
  tasks.push({
    label: "Order placed",
    done: true,
    timestamp: order.created_at,
  })

  // Cancelled shortcut
  if (status === "canceled") {
    tasks.push({ label: "Order cancelled", done: true })
    return tasks
  }

  // 2. Payment
  const paymentDone =
    paymentStatus === "captured" ||
    paymentStatus === "authorized" ||
    paymentStatus === "partially_captured"

  tasks.push({
    label: paymentDone ? "Payment confirmed" : "Awaiting payment",
    done: paymentDone,
    timestamp: paymentDone
      ? order.payment_collections?.[0]?.created_at
      : null,
  })

  // 3. Processing / Fulfillment
  const isFulfilling =
    fulfillmentStatus === "partially_fulfilled" ||
    fulfillmentStatus === "fulfilled" ||
    fulfillmentStatus === "partially_shipped" ||
    fulfillmentStatus === "shipped" ||
    fulfillmentStatus === "partially_delivered" ||
    fulfillmentStatus === "delivered"

  tasks.push({
    label: isFulfilling ? "Order processed" : "Processing order",
    done: isFulfilling,
  })

  // 4. Packed
  const isPacked = !!latestFulfillment?.packed_at
  const isShipped =
    fulfillmentStatus === "shipped" ||
    fulfillmentStatus === "partially_shipped" ||
    fulfillmentStatus === "delivered" ||
    fulfillmentStatus === "partially_delivered" ||
    !!latestFulfillment?.shipped_at

  tasks.push({
    label: isPacked ? "Packed" : "Packing order",
    done: isPacked || isShipped,
    timestamp: latestFulfillment?.packed_at,
  })

  // 5. Shipped
  tasks.push({
    label: isShipped ? "Shipped" : "Awaiting shipment",
    done: isShipped,
    timestamp: latestFulfillment?.shipped_at,
  })

  // 6. Delivered
  const isDelivered =
    fulfillmentStatus === "delivered" ||
    !!latestFulfillment?.delivered_at

  tasks.push({
    label: isDelivered ? "Delivered" : "Out for delivery",
    done: isDelivered,
    timestamp: latestFulfillment?.delivered_at,
  })

  return tasks
}

const OrderStatusTimeline = ({
  order,
  variant = "compact",
}: OrderStatusTimelineProps) => {
  const tasks = getOrderTimeline(order)
  const doneTasks = tasks.filter((t) => t.done).length
  const progress =
    tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0

  const isCompact = variant === "compact"

  return (
    <div className={isCompact ? "" : "py-4"}>
      {/* Progress bar */}
      <div className={isCompact ? "mb-2" : "mb-4"}>
        <div
          className={`flex justify-between text-xs text-gray-500 ${isCompact ? "mb-1" : "mb-1.5"}`}
        >
          <span className={isCompact ? "" : "text-sm"}>Progress</span>
          <span className={isCompact ? "" : "text-sm"}>
            {doneTasks}/{tasks.length} steps
          </span>
        </div>
        <div
          className={`bg-gray-100 rounded-full overflow-hidden ${isCompact ? "h-1.5" : "h-2"}`}
        >
          <div
            className="h-full bg-blue-400 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Task checklist */}
      <ul
        className={`flex flex-col ${isCompact ? "gap-y-1 pl-1" : "gap-y-2"}`}
      >
        {tasks.map((task, i) => (
          <li
            key={i}
            className={`flex items-center gap-x-2 ${isCompact ? "text-xs" : "text-sm"}`}
          >
            <span
              className={`flex-shrink-0 rounded-full flex items-center justify-center font-bold ${
                task.done
                  ? "bg-green-100 text-green-600"
                  : "bg-blue-100 text-blue-500"
              } ${isCompact ? "w-4 h-4 text-[9px]" : "w-5 h-5 text-[10px]"}`}
            >
              {task.done ? "✓" : "→"}
            </span>
            <span
              className={
                task.done
                  ? "text-gray-400 line-through"
                  : "text-gray-700 font-medium"
              }
            >
              {task.label}
            </span>
            {!isCompact && task.timestamp && (
              <span className="text-xs text-gray-400 ml-auto">
                {new Date(task.timestamp).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export { getOrderTimeline }
export default OrderStatusTimeline
