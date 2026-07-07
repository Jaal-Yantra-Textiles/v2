import { Text, clx } from "@medusajs/ui"
import { ReactNode } from "react"

export type SectionRowProps = {
  title: string
  value?: ReactNode | string | null
  actions?: ReactNode
}

export const SectionRow = ({ title, value, actions }: SectionRowProps) => {
  const isValueString = typeof value === "string" || !value

  return (
    <div
      className={clx(
        // Stack title over value on mobile; restore the 2-col key/value grid at sm+.
        `text-ui-fg-subtle grid w-full grid-cols-1 items-start gap-1 px-6 py-4 sm:grid-cols-2 sm:items-center sm:gap-4`,
        {
          "sm:grid-cols-[1fr_1fr_28px]": !!actions,
        }
      )}
    >
      <Text size="small" weight="plus" leading="compact">
        {title}
      </Text>

      {isValueString ? (
        <Text
          size="small"
          leading="compact"
          className="whitespace-pre-line text-pretty"
        >
          {value ?? "-"}
        </Text>
      ) : (
        <div className="flex flex-wrap gap-1">{value}</div>
      )}

      {actions && <div>{actions}</div>}
    </div>
  )
}
