import {
  Text,
} from "@medusajs/ui"
import { InformationCircleSolid, ExclamationCircle } from "@medusajs/icons"

export const InfoBanner = ({
  title,
  description,
  variant = "info",
}: {
  title: string
  description: string
  variant?: "info" | "warning"
}) => (
  <div className="flex items-start gap-x-3 rounded-xl border border-ui-border-base bg-ui-bg-subtle px-4 py-3 mx-6 my-3">
    {variant === "warning" ? (
      <ExclamationCircle className="mt-0.5 shrink-0 text-ui-tag-orange-icon" />
    ) : (
      <InformationCircleSolid className="mt-0.5 shrink-0 text-ui-fg-interactive" />
    )}
    <div className="flex flex-col gap-y-0.5">
      <Text size="small" weight="plus" className="text-ui-fg-base">
        {title}
      </Text>
      <Text size="xsmall" className="text-ui-fg-subtle">
        {description}
      </Text>
    </div>
  </div>
)
