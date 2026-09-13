import {
  Text,
  Tooltip,
  clx,
} from "@medusajs/ui"
import { formatDateTime, formatFullDate } from "../../lib/run-formatting"

export const TimelineItem = ({
  label,
  dateStr,
  duration,
  isLast,
  dotColor = "bg-ui-tag-neutral-icon",
}: {
  label: string
  dateStr: string
  duration?: string
  isLast?: boolean
  dotColor?: string
}) => (
  <div className="grid grid-cols-[20px_1fr] items-start gap-2">
    <div className="flex size-full flex-col items-center gap-y-0.5">
      <div className="flex size-5 items-center justify-center">
        <div className="bg-ui-bg-base shadow-borders-base flex size-2.5 items-center justify-center rounded-full">
          <div className={clx("size-1.5 rounded-full", dotColor)} />
        </div>
      </div>
      {!isLast && <div className="bg-ui-border-base w-px flex-1" />}
    </div>
    <div className={clx({ "pb-3": !isLast })}>
      <div className="flex items-center justify-between gap-2">
        <Text size="small" leading="compact" weight="plus">
          {label}
        </Text>
        <Tooltip content={formatFullDate(dateStr)}>
          <Text size="small" leading="compact" className="text-ui-fg-subtle text-right cursor-default">
            {formatDateTime(dateStr)}
          </Text>
        </Tooltip>
      </div>
      {duration && (
        <Text size="xsmall" className="text-ui-fg-muted">{duration}</Text>
      )}
    </div>
  </div>
)
