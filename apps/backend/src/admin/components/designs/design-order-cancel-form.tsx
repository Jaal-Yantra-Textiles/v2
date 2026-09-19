import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Text, Textarea, toast } from "@medusajs/ui"
import { z } from "@medusajs/framework/zod"
import { useForm } from "react-hook-form"

import { Form } from "../common/form"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { useRouteModal } from "../modal/use-route-modal"
import { useCancelPendingDesignOrder } from "../../hooks/api/design-orders"

/**
 * Retire a design order that should never be paid (#2176 item 6).
 *
 * Until this existed a wrong design order could only be ABANDONED — left in
 * the list forever, indistinguishable from one a customer simply had not paid
 * yet. The case that prompted it: an INR order for a buyer in the EU, on the
 * India region, which offers PayU and nothing else.
 *
 * 🔑 SOFT. The record, its price and its links stay — they are the evidence of
 * what was offered and for how much. What goes is the PAYABILITY: the detail
 * route stops returning a checkout link.
 *
 * 🔴 The reason is required by the API, so it is required here. A cancelled
 * design order and a stale one look identical a month later, and the reason is
 * the whole difference. A field the form could leave empty would be empty on
 * every row that mattered.
 */
const schema = z.object({
  reason: z
    .string("Say why this is being cancelled.")
    .trim()
    .min(
      3,
      "Say why — a cancelled design order and a stale one look identical later."
    ),
})

type FormValues = z.infer<typeof schema>

export const DesignOrderCancelForm = ({
  lineItemId,
  title,
  price,
  currencyCode,
}: {
  lineItemId: string
  title: string
  price: number | null
  currencyCode: string
}) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useCancelPendingDesignOrder(lineItemId)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  })

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await mutateAsync({ reason: data.reason })
      toast.success("Design order cancelled. Its checkout link no longer works.")
      handleSuccess()
    } catch (e: any) {
      /*
        Verbatim. The route's refusals each name the remedy — a converted order
        answers 409 with "cancel the order itself", an already-cancelled one
        names the date it was cancelled on. A generic "failed" would leave an
        operator retrying something that can never succeed.
      */
      toast.error(e?.message || "Could not cancel this design order.")
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
              {price === null
                ? "No price recorded"
                : `${price} ${currencyCode.toUpperCase()}`}
            </Text>
          </div>

          <Text size="small" className="text-ui-fg-subtle">
            The order stays on record with its price and links — what stops is
            the checkout link. Nothing is deleted.
          </Text>

          <Form.Field
            control={form.control}
            name="reason"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Reason</Form.Label>
                <Form.Control>
                  <Textarea
                    {...field}
                    autoComplete="off"
                    rows={3}
                    placeholder="e.g. Wrong currency — buyer is in the EU, re-created in EUR"
                  />
                </Form.Control>
                <Form.Hint>
                  Whoever reads this in a month will not remember. Say what was
                  wrong with it.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary" type="button">
                Keep it
              </Button>
            </RouteDrawer.Close>
            <Button
              size="small"
              variant="danger"
              type="submit"
              isLoading={isPending}
            >
              Cancel design order
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
