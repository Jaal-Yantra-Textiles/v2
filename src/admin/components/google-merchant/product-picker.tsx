import { Input, Popover, Text, clx } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useProducts } from "../../hooks/api/products"
import { useDebouncedSearch } from "../../hooks/use-debounce"

type Props = {
  value: { id: string; handle?: string | null } | null
  onChange: (value: { id: string; handle: string | null } | null) => void
  placeholder?: string
  disabled?: boolean
}

export const ProductPicker = ({ value, onChange, placeholder, disabled }: Props) => {
  const [open, setOpen] = useState(false)
  const { searchValue, onSearchValueChange, query } = useDebouncedSearch()

  const { products, isFetching } = useProducts(
    {
      q: query,
      limit: 20,
      fields: "id,handle,title",
    } as any,
    { enabled: open }
  )

  const label = useMemo(() => {
    if (!value) return placeholder || "Pick a product…"
    return value.handle || value.id
  }, [value, placeholder])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={clx(
            "txt-compact-small flex w-full items-center justify-between rounded-md border px-2 py-1 text-left",
            "border-ui-border-base bg-ui-bg-field hover:bg-ui-bg-field-hover",
            "disabled:cursor-not-allowed disabled:opacity-50",
            value ? "text-ui-fg-base" : "text-ui-fg-muted"
          )}
        >
          <span className="truncate">{label}</span>
          {value && (
            <span
              role="button"
              aria-label="Clear"
              className="ml-2 text-ui-fg-subtle hover:text-ui-fg-base"
              onClick={(e) => {
                e.stopPropagation()
                onChange(null)
              }}
            >
              ×
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content side="bottom" align="start" className="w-[360px] p-0">
        <div className="border-b p-2">
          <Input
            autoFocus
            size="small"
            placeholder="Search products by title or handle…"
            value={searchValue}
            onChange={(e) => onSearchValueChange(e.target.value)}
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {isFetching && (
            <div className="px-3 py-2">
              <Text size="xsmall" className="text-ui-fg-subtle">
                Loading…
              </Text>
            </div>
          )}
          {!isFetching && (products || []).length === 0 && (
            <div className="px-3 py-2">
              <Text size="xsmall" className="text-ui-fg-subtle">
                No products found
              </Text>
            </div>
          )}
          {(products || []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange({ id: p.id, handle: p.handle || null })
                setOpen(false)
              }}
              className={clx(
                "txt-compact-small flex w-full flex-col items-start gap-y-0.5 px-3 py-1.5 text-left",
                "hover:bg-ui-bg-base-hover"
              )}
            >
              <span className="font-medium">{p.title}</span>
              <span className="text-ui-fg-subtle">{p.handle}</span>
            </button>
          ))}
        </div>
      </Popover.Content>
    </Popover>
  )
}
