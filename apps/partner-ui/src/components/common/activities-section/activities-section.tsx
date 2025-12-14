import { Container, Heading, Text, Tooltip, clx } from "@medusajs/ui"
import { ReactNode } from "react"

import { useDate } from "../../../hooks/use-date"

export type ActivityItem = {
  id: string
  title: ReactNode
  status: ReactNode
  timestamp?: string | Date
}

type ActivitiesSectionProps = {
  title?: string
  items: ActivityItem[]
  actions?: ReactNode
}

export const ActivitiesSection = ({
  title = "Activities",
  items,
  actions,
}: ActivitiesSectionProps) => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{title}</Heading>
        {actions}
      </div>
      <div className="px-6 py-4">
        <div className="flex flex-col">
          {items.map((item, index) => {
            const isLast = index === items.length - 1

            return (
              <ActivitiesItem
                key={item.id}
                title={item.title}
                status={item.status}
                timestamp={item.timestamp}
                isLast={isLast}
              />
            )
          })}
        </div>
      </div>
    </Container>
  )
}

type ActivitiesItemProps = {
  title: ReactNode
  status: ReactNode
  timestamp?: string | Date
  isLast?: boolean
}

const ActivitiesItem = ({
  title,
  status,
  timestamp,
  isLast = false,
}: ActivitiesItemProps) => {
  const { getFullDate, getRelativeDate } = useDate()

  return (
    <div className="grid grid-cols-[20px_1fr] items-start gap-3">
      <div className="flex size-full flex-col items-center gap-y-0.5">
        <div className="flex size-5 items-center justify-center">
          <div className="bg-ui-bg-base shadow-borders-base flex size-2.5 items-center justify-center rounded-full">
            <div className="bg-ui-tag-neutral-icon size-1.5 rounded-full" />
          </div>
        </div>
        {!isLast && <div className="bg-ui-border-base w-px flex-1" />}
      </div>

      <div
        className={clx({
          "pb-6": !isLast,
        })}
      >
        <div className="flex items-start justify-between gap-x-4">
          <div className="min-w-0">
            <Text size="small" leading="compact" weight="plus" className="truncate">
              {title}
            </Text>
          </div>
          {timestamp && (
            <Tooltip content={getFullDate({ date: timestamp, includeTime: true })}>
              <Text
                size="small"
                leading="compact"
                className="text-ui-fg-subtle shrink-0 text-right"
              >
                {getRelativeDate(timestamp)}
              </Text>
            </Tooltip>
          )}
        </div>

        <div className="mt-1">
          <Text size="small" className="text-ui-fg-subtle">
            {status}
          </Text>
        </div>
      </div>
    </div>
  )
}
