import { zodResolver } from "@hookform/resolvers/zod"
import { useMemo, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Button, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { PencilSquare, Plus, XMarkMini } from "@medusajs/icons"
import { z } from "zod"

import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { KeyboundForm } from "../../../components/utilities/keybound-form"
import { Form } from "../../../components/common/form"
import { useCreateQuickProduct } from "../../../hooks/api/products"
import { usePartnerStores } from "../../../hooks/api/partner-stores"
import { usePartnerUpload } from "../../../hooks/api/uploads"
import { castNumber } from "../../../lib/cast-number"

const QuickProductSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  price: z.string().min(1, "Price is required"),
  stock_quantity: z.string().optional(),
})

type QuickProductSchemaType = z.infer<typeof QuickProductSchema>

export const ProductQuickCreate = () => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const { stores } = usePartnerStores()
  const store = stores?.[0] as any

  const defaultCurrency =
    (store?.supported_currencies || []).find((c: any) => c.is_default)
      ?.currency_code ??
    store?.supported_currencies?.[0]?.currency_code ??
    ""

  const [images, setImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { mutateAsync: upload, isPending: isUploading } = usePartnerUpload()
  const { mutateAsync: createProduct, isPending: isCreating } =
    useCreateQuickProduct()

  const form = useForm<QuickProductSchemaType>({
    defaultValues: {
      title: "",
      description: "",
      price: "",
      stock_quantity: "",
    },
    resolver: zodResolver(QuickProductSchema),
  })

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    try {
      const res = await upload(Array.from(files))
      const urls = (res.files || []).map((f: any) => f.url).filter(Boolean)
      setImages((prev) => [...prev, ...urls])
    } catch (e: any) {
      toast.error(e?.message || "Upload failed")
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const price = castNumber(values.price)
    const stockRaw = (values.stock_quantity || "").trim()
    const stock_quantity = stockRaw === "" ? undefined : castNumber(stockRaw)

    if (isNaN(price)) {
      form.setError("price", { message: "Enter a valid number" })
      return
    }
    if (stock_quantity !== undefined && isNaN(stock_quantity)) {
      form.setError("stock_quantity", { message: "Enter a valid number" })
      return
    }

    await createProduct(
      {
        title: values.title.trim(),
        description: values.description?.trim() || undefined,
        thumbnail: images[0],
        images,
        price,
        stock_quantity,
      },
      {
        onSuccess: () => {
          toast.success("Product created")
          handleSuccess("/products")
        },
        onError: (err: any) => {
          toast.error(err?.message || "Could not create product")
        },
      }
    )
  })

  const currencyLabel = useMemo(
    () => (defaultCurrency ? defaultCurrency.toUpperCase() : ""),
    [defaultCurrency]
  )

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Quick add product</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">
          Create a single-variant product with one price and one stock number.
        </span>
      </RouteFocusModal.Description>

      <RouteFocusModal.Form form={form}>
        <KeyboundForm
          onSubmit={onSubmit}
          className="flex size-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header />
          <RouteFocusModal.Body className="flex flex-col overflow-y-auto">
            <div className="mx-auto w-full max-w-xl px-4 py-8 flex flex-col gap-y-6">
              <div className="text-center">
                <Heading level="h1">Quick add product</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  One photo, title, price, stock — done.
                </Text>
              </div>

              {/* Photos */}
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  Photos
                </Label>
                <div className="flex flex-wrap gap-2">
                  {images.map((url) => (
                    <div
                      key={url}
                      className="relative group h-[60px] w-[60px] rounded-md overflow-hidden border border-ui-border-base"
                      title={url}
                    >
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover object-center"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setImages((prev) => prev.filter((u) => u !== url))
                        }
                        className="absolute -top-2 -right-2 invisible group-hover:visible bg-ui-bg-base border border-ui-border-base rounded-full p-0.5"
                        aria-label="Remove photo"
                      >
                        <XMarkMini />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex h-[60px] w-[60px] items-center justify-center rounded-md border border-dashed border-ui-border-base hover:border-ui-border-interactive text-ui-fg-muted hover:text-ui-fg-subtle"
                    aria-label="Add photo"
                  >
                    <Plus />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => onPickFiles(e.target.files)}
                  />
                </div>
                {isUploading && (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Uploading…
                  </Text>
                )}
              </div>

              {/* Title */}
              <Form.Field
                control={form.control}
                name="title"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Title</Form.Label>
                    <Form.Control>
                      <Input {...field} placeholder="Handmade cotton dari" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {/* Description */}
              <Form.Field
                control={form.control}
                name="description"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Description (optional)</Form.Label>
                    <Form.Control>
                      <Textarea
                        {...field}
                        rows={4}
                        placeholder="A few sentences about the product."
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {/* Price + Stock side by side */}
              <div className="grid grid-cols-2 gap-x-4">
                <Form.Field
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Price</Form.Label>
                      <Form.Control>
                        <div className="relative">
                          <Input
                            {...field}
                            inputMode="decimal"
                            placeholder="0"
                          />
                          {currencyLabel && (
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ui-fg-muted">
                              {currencyLabel}
                            </span>
                          )}
                        </div>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  control={form.control}
                  name="stock_quantity"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Stock</Form.Label>
                      <Form.Control>
                        <Input
                          {...field}
                          inputMode="numeric"
                          placeholder="0"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>

              <Text size="xsmall" className="text-ui-fg-muted">
                This creates a single-variant product priced in {currencyLabel || "your default currency"}
                {" "}with stock at your default warehouse. Switch to{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => handleSuccess("/products/create/advanced")}
                >
                  Advanced
                </button>{" "}
                if you need variants or regional pricing.
              </Text>
            </div>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <div className="flex w-full items-center justify-end gap-x-2">
              <RouteFocusModal.Close asChild>
                <Button variant="secondary" size="small" type="button">
                  {t("actions.cancel")}
                </Button>
              </RouteFocusModal.Close>
              <Button
                type="submit"
                variant="primary"
                size="small"
                isLoading={isCreating}
              >
                <PencilSquare />
                Create
              </Button>
            </div>
          </RouteFocusModal.Footer>
        </KeyboundForm>
      </RouteFocusModal.Form>
    </RouteFocusModal>
  )
}
