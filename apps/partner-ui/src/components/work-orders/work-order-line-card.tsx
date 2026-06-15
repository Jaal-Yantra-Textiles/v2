import { ReactNode } from "react"
import { Text } from "@medusajs/ui"

import { Thumbnail } from "../common/thumbnail"

/**
 * #342 — shared work-order line-item card. Mirrors the retail fulfillment item
 * primitive (`order-create-fulfillment-item.tsx`): a subtle elevated card with
 * a thumbnail, title/subtitle, and a right-aligned slot for stats or a quantity
 * input — so inventory work-orders read like a normal order's item list.
 */
export const WorkOrderLineCard = ({
  title,
  subtitle,
  thumbnail,
  children,
}: {
  title: string
  subtitle?: ReactNode
  thumbnail?: string | null
  /** Right-aligned stat columns (`WorkOrderLineStat`) or a quantity control. */
  children?: ReactNode
}) => (
  <div className="bg-ui-bg-subtle shadow-elevation-card-rest my-2 rounded-xl">
    <div className="flex flex-col gap-x-2 gap-y-3 p-3 text-sm sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-x-3">
        <Thumbnail src={thumbnail} alt={title} />
        <div className="flex min-w-0 flex-col">
          <Text className="txt-small truncate" as="span" weight="plus" title={title}>
            {title}
          </Text>
          {subtitle && (
            <Text as="div" className="text-ui-fg-subtle txt-small truncate">
              {subtitle}
            </Text>
          )}
        </div>
      </div>
      {children && (
        <div className="flex items-center gap-x-4 sm:justify-end">{children}</div>
      )}
    </div>
  </div>
)

/** A labelled, right-aligned figure — the retail fulfillment "Available / In stock" column shape. */
export const WorkOrderLineStat = ({
  label,
  value,
  emphasis,
}: {
  label: string
  value: ReactNode
  emphasis?: boolean
}) => (
  <div className="flex min-w-[64px] flex-col text-right">
    <span className="text-ui-fg-subtle font-medium">{label}</span>
    <span className={emphasis ? "text-ui-fg-base" : "text-ui-fg-subtle"}>
      {value}
    </span>
  </div>
)
