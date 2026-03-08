import {
  Button,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  Badge,
  FocusModal,
  toast,
} from "@medusajs/ui"
import { ShoppingBag, ThumbnailBadge } from "@medusajs/icons"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { MediaFile } from "../../hooks/api/media-folders"
import { useCreateProductFromMedia, SizeQuantities } from "../../hooks/api/use-create-product-from-media"
import { getThumbUrl } from "../../lib/media"
import { Spinner } from "../ui/spinner"

const MAX_PHOTOS = 4

interface CreateProductFromMediaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedMedia: MediaFile[]
  folderId: string
  onSuccess?: () => void
}

export const CreateProductFromMediaModal = ({
  open,
  onOpenChange,
  selectedMedia,
  folderId,
  onSuccess,
}: CreateProductFromMediaModalProps) => {
  const [title, setTitle] = useState("")
  const [price, setPrice] = useState("")
  const [manageInventory, setManageInventory] = useState(false)
  const [quantities, setQuantities] = useState<SizeQuantities>({ S: undefined, M: undefined, L: undefined })
  const navigate = useNavigate()
  const createMutation = useCreateProductFromMedia()

  // Enforce max 4 images — should already be enforced before opening, but guard here too
  const media = selectedMedia.slice(0, MAX_PHOTOS)

  const handleClose = () => {
    setTitle("")
    setPrice("")
    setManageInventory(false)
    setQuantities({ S: undefined, M: undefined, L: undefined })
    onOpenChange(false)
  }

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("Product title is required")
      return
    }

    const mediaFiles = media.map((m) => ({ id: m.id, url: m.file_path }))

    try {
      const priceAmount = price.trim() ? parseFloat(price.trim()) : undefined

      const product = await createMutation.mutateAsync({
        title: title.trim(),
        mediaFiles,
        folderId,
        price: priceAmount,
        manageInventory,
        quantities: manageInventory ? quantities : undefined,
      })

      toast.success(`Draft product "${product.title}" created`, {
        action: {
          label: "View product",
          onClick: () => navigate(`/products/${product.id}`),
        },
      })

      handleClose()
      onSuccess?.()
    } catch {
      // error handled by mutation onError
    }
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center gap-x-2">
            <ShoppingBag className="text-ui-fg-interactive" />
            <Heading level="h2">Create draft product</Heading>
          </div>
        </FocusModal.Header>

        <FocusModal.Body className="overflow-y-auto">
          <div className="mx-auto w-full max-w-xl px-6 py-8 flex flex-col gap-y-8">

            {/* Selected photos preview */}
            <div className="flex flex-col gap-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-ui-fg-base">
                  Product photos
                </Label>
                <Text size="xsmall" className="text-ui-fg-muted">
                  {media.length} of {MAX_PHOTOS} max
                </Text>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {media.map((m, i) => (
                  <div key={m.id} className="relative aspect-square overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-subtle">
                    <img
                      src={getThumbUrl(m.file_path, { width: 256, quality: 80, fit: "cover" })}
                      alt={`Photo ${i + 1}`}
                      className="size-full object-cover"
                    />
                    {i === 0 && (
                      <div className="absolute left-1.5 top-1.5">
                        <ThumbnailBadge />
                      </div>
                    )}
                    <div className="absolute bottom-1.5 right-1.5">
                      <Badge size="xsmall" color="grey" className="text-[9px] font-semibold tabular-nums">
                        {i + 1}
                      </Badge>
                    </div>
                  </div>
                ))}
                {/* Empty slots */}
                {Array.from({ length: MAX_PHOTOS - media.length }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="aspect-square rounded-xl border border-dashed border-ui-border-base bg-ui-bg-subtle"
                  />
                ))}
              </div>
              <Text size="xsmall" className="text-ui-fg-muted">
                First photo is used as thumbnail. Order follows your selection.
              </Text>
            </div>

            {/* Title */}
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="product-title" className="text-ui-fg-base">
                Product title <span className="text-ui-fg-error">*</span>
              </Label>
              <Input
                id="product-title"
                placeholder="e.g. Cotton Linen Summer Shirt"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate() }}
              />
            </div>

            {/* Price */}
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="product-price" className="text-ui-fg-base">
                Price (USD)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ui-fg-muted text-sm">$</span>
                <Input
                  id="product-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="pl-7"
                />
              </div>
              <Text size="xsmall" className="text-ui-fg-muted">
                Applied to all sizes (S, M, L). Leave blank to set pricing later.
              </Text>
            </div>

            {/* Inventory */}
            <div className="flex flex-col gap-y-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-y-0.5">
                  <Label className="text-ui-fg-base">Manage inventory</Label>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Track stock levels per size. Requires a stock location to be configured.
                  </Text>
                </div>
                <Switch
                  checked={manageInventory}
                  onCheckedChange={setManageInventory}
                />
              </div>

              {manageInventory && (
                <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle p-4 flex flex-col gap-y-3">
                  <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                    Initial stock quantity per size
                  </Text>
                  {(["S", "M", "L"] as const).map((size) => (
                    <div key={size} className="flex items-center gap-x-3">
                      <span className="w-6 text-sm font-medium text-ui-fg-base text-center">{size}</span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={quantities[size] ?? ""}
                        onChange={(e) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [size]: e.target.value ? parseInt(e.target.value, 10) : undefined,
                          }))
                        }
                        className="flex-1"
                      />
                      <Text size="xsmall" className="text-ui-fg-muted w-6">
                        pcs
                      </Text>
                    </div>
                  ))}
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Stock is added to your first configured stock location.
                  </Text>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="rounded-xl border border-ui-border-base bg-ui-bg-subtle px-4 py-3 flex flex-col gap-y-1">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                What gets created
              </Text>
              <ul className="flex flex-col gap-y-0.5 list-disc list-inside">
                {[
                  "Draft product — not visible to customers until published",
                  "Size option with S, M, L variants",
                  manageInventory ? "Inventory tracked per size at your stock location" : "Inventory untracked — enable above to set stock",
                  "Photos attached as product images",
                  "Linked back to this media folder in metadata",
                ].map((item) => (
                  <li key={item}>
                    <Text size="xsmall" className="text-ui-fg-muted inline">{item}</Text>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </FocusModal.Body>

        <FocusModal.Footer>
          <div className="flex w-full items-center justify-end gap-x-2">
            <Button
              size="small"
              variant="secondary"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={handleCreate}
              disabled={createMutation.isPending || !title.trim()}
            >
              {createMutation.isPending ? (
                <div className="flex items-center gap-x-2">
                  <Spinner className="text-ui-fg-on-color" size="small" />
                  Creating…
                </div>
              ) : (
                <div className="flex items-center gap-x-2">
                  <ShoppingBag />
                  Create draft product
                </div>
              )}
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
