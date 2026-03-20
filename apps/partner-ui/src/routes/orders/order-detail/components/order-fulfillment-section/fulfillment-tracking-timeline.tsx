import { Container, Text, Badge } from "@medusajs/ui"
import { format } from "date-fns"

type TrackingEvent = {
  timestamp: string
  status: string
  location: string
  scan_type: string
}

type FulfillmentTrackingTimelineProps = {
  tracking: {
    waybill: string
    carrier: string
    current_status: string
    current_status_type: string
    estimated_delivery: string | null
    events: TrackingEvent[]
  } | null
  isLoading: boolean
}

const scanTypeColor = (scanType: string): string => {
  switch (scanType) {
    case "DL":
    case "delivered":
      return "bg-ui-tag-green-icon"
    case "UD":
    case "OT":
    case "shipped":
      return "bg-ui-tag-blue-icon"
    case "RT":
    case "canceled":
      return "bg-ui-tag-red-icon"
    case "PP":
    case "PU":
      return "bg-ui-tag-orange-icon"
    default:
      return "bg-ui-tag-neutral-icon"
  }
}

export const FulfillmentTrackingTimeline = ({
  tracking,
  isLoading,
}: FulfillmentTrackingTimelineProps) => {
  if (isLoading) {
    return (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-muted">
          Loading tracking information...
        </Text>
      </div>
    )
  }

  if (!tracking || !tracking.events?.length) {
    return (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-muted">
          No tracking events available yet.
        </Text>
      </div>
    )
  }

  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <Text size="small" weight="plus">
          Tracking: {tracking.waybill}
        </Text>
        <Badge color="grey" size="2xsmall">
          {tracking.current_status}
        </Badge>
      </div>

      {tracking.estimated_delivery && (
        <Text size="small" className="text-ui-fg-muted mb-3">
          Est. delivery:{" "}
          {format(new Date(tracking.estimated_delivery), "dd MMM, yyyy")}
        </Text>
      )}

      <div className="relative ml-2">
        {tracking.events.map((event, idx) => {
          const isFirst = idx === 0
          const isLast = idx === tracking.events.length - 1

          return (
            <div key={idx} className="relative flex gap-x-3 pb-4 last:pb-0">
              {/* Vertical line */}
              {!isLast && (
                <div className="bg-ui-border-base absolute left-[5px] top-3 h-full w-px" />
              )}

              {/* Dot */}
              <div
                className={`relative mt-1.5 h-[11px] w-[11px] flex-shrink-0 rounded-full ${
                  isFirst
                    ? scanTypeColor(event.scan_type)
                    : "bg-ui-border-strong"
                }`}
              />

              {/* Content */}
              <div className="flex-1 min-w-0">
                <Text
                  size="small"
                  weight={isFirst ? "plus" : "regular"}
                  leading="compact"
                >
                  {event.status}
                </Text>
                <div className="flex items-center gap-x-2">
                  {event.location && (
                    <Text
                      size="small"
                      className="text-ui-fg-muted"
                      leading="compact"
                    >
                      {event.location}
                    </Text>
                  )}
                  {event.timestamp && (
                    <Text
                      size="small"
                      className="text-ui-fg-muted"
                      leading="compact"
                    >
                      {format(
                        new Date(event.timestamp),
                        "dd MMM, HH:mm"
                      )}
                    </Text>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
