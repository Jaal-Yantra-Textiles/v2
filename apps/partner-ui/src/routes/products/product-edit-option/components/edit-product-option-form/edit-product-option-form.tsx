import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "@medusajs/framework/zod"

import { HttpTypes } from "@medusajs/types"
import { Form } from "../../../../../components/common/form"
import { ChipInput } from "../../../../../components/inputs/chip-input"
import { RouteDrawer, useRouteModal } from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import {
  usePaletteForTitle,
  useUpdateProductOption,
} from "../../../../../hooks/api/products"
import { ColourPicker } from "../../../../../components/inputs/colour-picker"

type EditProductOptionFormProps = {
  option: HttpTypes.AdminProductOption
  /** From the route — `option.product_id` is null since options went global. */
  productId: string
}

// A colour the partner adds arrives as { value, hex } — the backend needs the
// hex to store a swatch, and a plain string would be refused as "not in the
// palette". Existing values stay plain strings.
const CreateProductOptionSchema = z.object({
  title: z.string().min(1),
  values: z
    .array(
      z.union([
        z.string(),
        z.object({ value: z.string(), hex: z.string() }),
      ])
    )
    .optional(),
})

export const CreateProductOptionForm = ({
  option,
  productId,
}: EditProductOptionFormProps) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()

  const form = useForm<z.infer<typeof CreateProductOptionSchema>>({
    defaultValues: {
      title: option.title,
      values: (option.values || []).map((v: any) => v?.value ?? v),
    },
    resolver: zodResolver(CreateProductOptionSchema),
  })

  const titleValue = form.watch("title")
  const { palette } = usePaletteForTitle(titleValue)

  const { mutateAsync, isPending } = useUpdateProductOption(productId, option.id)

  const handleSubmit = form.handleSubmit(async (values) => {
    mutateAsync(
      {
        id: option.id,
        ...values,
      },
      {
        onSuccess: () => {
          handleSuccess()
        },
      }
    )
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-4 overflow-auto">
          <Form.Field
            control={form.control}
            name="title"
            render={({ field }) => {
              return (
                <Form.Item>
                  <Form.Label>
                    {t("products.fields.options.optionTitle")}
                  </Form.Label>
                  <Form.Control>
                    <Input
                      {...field}
                      placeholder={t(
                        "products.fields.options.optionTitlePlaceholder"
                      )}
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )
            }}
          />
          <Form.Field
            control={form.control}
            name="values"
            render={({ field: { ...field } }) => {
              return (
                <Form.Item>
                  <Form.Label>
                    {t("products.fields.options.variations")}
                  </Form.Label>
                  <Form.Control>
                    {/* Swatches for the shared Colour vocabulary, free text
                        for an option the partner authored themselves. */}
                    {palette ? (
                      <ColourPicker
                        palette={palette.values}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    ) : (
                      <ChipInput
                        {...field}
                        placeholder={t(
                          "products.fields.options.variantionsPlaceholder"
                        )}
                      />
                    )}
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )
            }}
          />
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button variant="secondary" size="small">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button type="submit" size="small" isLoading={isPending}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
