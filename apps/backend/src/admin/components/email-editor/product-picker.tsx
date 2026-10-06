import { Drawer, Heading, Input, Select, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useEmailEditorProducts } from "../../hooks/api/products"
import { formatPriceLabel, productCardFromProduct, type ProductCardAttrs } from "./product-card-data"

const CURRENCIES = ["inr", "usd", "eur", "gbp"] as const
const SEARCH_DEBOUNCE_MS = 300

type ProductPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (card: ProductCardAttrs) => void
}

/**
 * #2349 S4 — choose a product for a card. Only the house store's published
 * products (GET /admin/email-editor/products): the card's link goes to
 * cicilabel.com, so a partner's product there would 404.
 */
export const ProductPicker = ({ open, onOpenChange, onPick }: ProductPickerProps) => {
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [currency, setCurrency] = useState<string>("inr")

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const { products, isLoading: loading, isError } = useEmailEditorProducts(
    { q: q || undefined, limit: 30 },
    { enabled: open }
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content className="max-w-[560px]">
        <Drawer.Header>
          <Heading>Add a product</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Products on cicilabel.com. The card shows the photo, name, price and a Shop button. The
            price is copied now — add the card again if it changes before you send.
          </Text>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-3 overflow-hidden">
          <div className="flex gap-2">
            <Input
              placeholder="Search products"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="flex-1"
            />
            <Select value={currency} onValueChange={setCurrency}>
              <Select.Trigger className="w-24">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {CURRENCIES.map((c) => (
                  <Select.Item key={c} value={c}>
                    {c.toUpperCase()}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isError && (
              <Text size="small" className="text-ui-fg-error">
                Could not load products.
              </Text>
            )}
            {loading && <Text size="small" className="text-ui-fg-muted">Loading products…</Text>}
            {!loading && !isError && !products?.length && (
              <Text size="small" className="text-ui-fg-muted">No published products match.</Text>
            )}
            <ul className="flex flex-col gap-1">
              {(products ?? []).map((product) => {
                const price = formatPriceLabel(product.variants, currency)
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      data-testid="product-picker-item"
                      className="hover:bg-ui-bg-base-hover flex w-full items-center gap-3 rounded-md p-2 text-left"
                      onClick={() => onPick(productCardFromProduct(product, currency))}
                    >
                      {product.thumbnail ? (
                        <img src={product.thumbnail} alt="" className="h-12 w-12 rounded object-cover" />
                      ) : (
                        <div className="bg-ui-bg-subtle h-12 w-12 rounded" />
                      )}
                      <div className="flex min-w-0 flex-col">
                        <Text size="small" weight="plus" className="truncate">
                          {product.title}
                        </Text>
                        <Text size="xsmall" className={price ? "text-ui-fg-muted" : "text-ui-fg-error"}>
                          {price ?? `No ${currency.toUpperCase()} price`}
                        </Text>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}
