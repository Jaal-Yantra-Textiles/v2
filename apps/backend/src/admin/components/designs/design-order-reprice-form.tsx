import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, Text, toast } from "@medusajs/ui"
import { z } from "@medusajs/framework/zod"
import { useForm } from "react-hook-form"

import { Form } from "../common/form"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { useRouteModal } from "../modal/use-route-modal"
import { useRepriceDesignOrder } from "../../hooks/api/design-orders"

/**
 * The price on an existing design order line (#1970 PR5).
 *
 * The line is `is_custom_price: true`, so nothing recalculates it — which is
 * what makes writing it safe, and equally why nothing will ever correct a
 * wrong one. The number typed here is the number the buyer pays.
 *
 * There is deliberately no currency field. The cart's region fixes the
 * currency; a price entered in another one would be valued by one number and
 * labelled by another — the #1979 shape.
 */
const schema = z.object({
  /**
   * A plain number, NOT `z.coerce.number()`: coerce types its INPUT as
   * `unknown`, which breaks react-hook-form's Resolver generics (the same
   * trap `z.preprocess` sprang in PR4). The string→number conversion belongs
   * at the input instead — see `valueAsNumber` below.
   *
   * `positive()` rather than a null check: an empty box yields NaN and
   * `Number("")` is 0, and a price of 0 is a claim, not a price (#1900).
   */
  unit_price: z
    .number("Enter a price.")
    .finite("Enter a real number.")
    .positive("A price of 0 is a claim, not a price."),
})

type FormValues = z.infer<typeof schema>

export const DesignOrderRepriceForm = ({
  lineItemId,
  currentPrice,
  currencyCode,
  title,
}: {
  lineItemId: string
  currentPrice: number | null
  currencyCode: string
  title: string
}) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useRepriceDesignOrder(lineItemId)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { unit_price: currentPrice ?? undefined },
  })

  const onSubmit = form.handleSubmit(async (data) => {
    // The API refuses an unchanged price with a 400; close rather than make
    // the operator read an error for doing nothing.
    if (currentPrice !== null && data.unit_price === currentPrice) {
      handleSuccess()
      return
    }
    try {
      const res = await mutateAsync({ unit_price: data.unit_price })
      const { previous_unit_price, unit_price } = res.design_order_reprice
      toast.success(
        previous_unit_price === null
          ? `Priced at ${unit_price} ${currencyCode.toUpperCase()}.`
          : `Repriced ${previous_unit_price} → ${unit_price} ${currencyCode.toUpperCase()}.`
      )
      handleSuccess()
    } catch (e: any) {
      /*
        Verbatim. A converted design order answers 409 with "reprice it through
        an order edit, not the cart" — a generic "failed" would leave an
        operator retrying something that can never succeed.
      */
      toast.error(e?.message || "Could not reprice this design order line.")
    }
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto">
          <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
            <Text size="small" leading="compact" weight="plus">
              {title}
            </Text>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {currentPrice === null
                ? "No price recorded"
                : `Currently ${currentPrice} ${currencyCode.toUpperCase()}`}
            </Text>
          </div>

          <Form.Field
            control={form.control}
            name="unit_price"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Price ({currencyCode.toUpperCase()})</Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    autoFocus
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={Number.isFinite(field.value) ? field.value : ""}
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                  />
                </Form.Control>
                <Form.Hint>
                  What the buyer pays for one unit. Nothing recalculates this
                  afterwards.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </RouteDrawer.Body>

        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              Save
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
