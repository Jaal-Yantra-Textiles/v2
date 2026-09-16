import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, Text, toast } from "@medusajs/ui"
import { z } from "@medusajs/framework/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"

import { Form } from "../common/form"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { useRouteModal } from "../modal/use-route-modal"
import {
  useAttachDesignOrderCustomer,
  useCustomerSearch,
} from "../../hooks/api/design-orders"

/**
 * The buyer on an existing design order (#1970 PR5).
 *
 * A Drawer rather than a FocusModal because this EDITS an entity that already
 * exists — the design order is there, only its buyer is being changed.
 *
 * 🔑 The search query is modal-scoped (`enabled` on a typed term) and is
 * deliberately NOT what renders the current buyer. The buyer comes from the
 * design order the parent page already loaded, so it survives a refresh with
 * the drawer closed. Wiring the display to the search result is the
 * conditional-display-query mistake: on mount the search has not run, and the
 * panel would read "no customer" on an order that has one.
 */
const schema = z.object({
  customer_id: z.string().min(1, "Choose a customer, or remove the current one."),
})

type FormValues = z.infer<typeof schema>

type CurrentCustomer = {
  id?: string | null
  email?: string | null
  first_name?: string | null
  last_name?: string | null
} | null

const displayName = (c: {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}) => [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unnamed customer"

export const DesignOrderCustomerForm = ({
  lineItemId,
  customer,
}: {
  lineItemId: string
  customer: CurrentCustomer
}) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useAttachDesignOrderCustomer(lineItemId)

  const [search, setSearch] = useState("")
  const { data: results, isLoading: searching } = useCustomerSearch(search)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { customer_id: customer?.id ?? "" },
  })

  const selectedId = form.watch("customer_id")

  const onSubmit = form.handleSubmit(async (data) => {
    // Nothing changed — close rather than write, so a re-save is not a no-op
    // round trip that still churns the links.
    if (data.customer_id === (customer?.id ?? "")) {
      handleSuccess()
      return
    }
    try {
      await mutateAsync({ customer_id: data.customer_id })
      toast.success("Buyer updated on this design order.")
      handleSuccess()
    } catch (e: any) {
      /*
        Surfaced verbatim. A converted design order answers 409 with "change
        the customer on the order itself" — a generic "failed" would leave an
        operator retrying something that can never succeed.
      */
      toast.error(e?.message || "Could not change the buyer on this design order.")
    }
  })

  const remove = async () => {
    try {
      await mutateAsync({ customer_id: null })
      toast.success("The buyer was removed from this design order.")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Could not remove the buyer.")
    }
  }

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto">
          {customer?.id ? (
            <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
              <Text size="small" leading="compact" weight="plus">
                {displayName(customer)}
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {customer.email} — the current buyer
              </Text>
            </div>
          ) : (
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              This design order has no buyer. Until one is attached, checkout has
              no address to send anything to.
            </Text>
          )}

          <Form.Field
            control={form.control}
            name="customer_id"
            render={({ field: { onChange } }) => (
              <Form.Item>
                <Form.Label>Buyer</Form.Label>
                <Form.Control>
                  <div className="flex flex-col gap-y-2">
                    <Input
                      placeholder="Search customers by name or email"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      autoFocus
                    />
                    <div className="flex flex-col divide-y divide-ui-border-base">
                      {searching ? (
                        <Text
                          size="small"
                          leading="compact"
                          className="text-ui-fg-subtle py-2"
                        >
                          Searching…
                        </Text>
                      ) : results?.customers?.length ? (
                        results.customers.map((c) => {
                          const isSelected = selectedId === c.id
                          return (
                            <button
                              key={c.id}
                              type="button"
                              disabled={isPending}
                              onClick={() => onChange(c.id)}
                              className={`flex flex-col items-start rounded-md px-2 py-2 text-left transition-fg hover:bg-ui-bg-base-hover disabled:opacity-50 ${
                                isSelected ? "bg-ui-bg-highlight" : ""
                              }`}
                            >
                              <Text size="small" leading="compact" weight="plus">
                                {displayName(c)}
                              </Text>
                              <Text
                                size="small"
                                leading="compact"
                                className="text-ui-fg-subtle"
                              >
                                {c.email}
                              </Text>
                            </button>
                          )
                        })
                      ) : (
                        <Text
                          size="small"
                          leading="compact"
                          className="text-ui-fg-subtle py-2"
                        >
                          {search
                            ? "No customers match that."
                            : "Type a name or email to search."}
                        </Text>
                      )}
                    </div>
                  </div>
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </RouteDrawer.Body>

        <RouteDrawer.Footer>
          <div className="flex items-center justify-between gap-x-2">
            {customer?.id ? (
              <Button
                size="small"
                variant="danger"
                type="button"
                onClick={remove}
                disabled={isPending}
              >
                Remove buyer
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-x-2">
              <RouteDrawer.Close asChild>
                <Button size="small" variant="secondary">
                  Cancel
                </Button>
              </RouteDrawer.Close>
              <Button size="small" type="submit" isLoading={isPending}>
                Save
              </Button>
            </div>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
