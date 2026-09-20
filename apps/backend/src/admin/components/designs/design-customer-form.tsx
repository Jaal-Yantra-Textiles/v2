import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Text, toast } from "@medusajs/ui"
import { z } from "@medusajs/framework/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"

import { Combobox } from "../inputs/combobox/combobox"
import { Form } from "../common/form"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { useRouteModal } from "../modal/use-route-modal"
import { useCustomerSearch } from "../../hooks/api/design-orders"
import { useAttachDesignCustomer } from "../../hooks/api/designs"

/**
 * Whose design this is (#2111).
 *
 * 🔴 Deliberately NOT the same control as the design ORDER's buyer. That one
 * takes a line item and needs an order to exist, so until this existed a design
 * could only acquire a customer by being SOLD — and a design that came out of a
 * conversation had no way to say who it was for, ever.
 *
 * Why that matters enough to build a second picker: every customer email about
 * a design resolves its recipient through this link and returns SILENTLY when
 * there is none. Not an error, not a warning — the send's `when` guard simply
 * does not fire. Five Oshen designs sat like that for a month while their
 * client watched the products on the storefront.
 *
 * 🔑 The current customer comes from the design the parent page already loaded,
 * never from the search query. Wiring the display to the search is the
 * conditional-display-query mistake: on mount the search has not run, and the
 * panel would read "nobody" on a design that has someone.
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
}) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") ||
  c.email ||
  "Unnamed customer"

export const DesignCustomerForm = ({
  designId,
  customer,
}: {
  designId: string
  customer: CurrentCustomer
}) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useAttachDesignCustomer(designId)

  const [search, setSearch] = useState("")
  const { data: results, isLoading: searching } = useCustomerSearch(search)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { customer_id: customer?.id ?? "" },
  })

  const options = (results?.customers ?? []).map((c) => ({
    value: c.id,
    label: `${displayName(c)} — ${c.email}`,
  }))

  const onSubmit = form.handleSubmit(async (data) => {
    // Nothing changed — close rather than write. A re-save would otherwise
    // dismiss and re-create the link for no reason.
    if (data.customer_id === (customer?.id ?? "")) {
      handleSuccess()
      return
    }
    try {
      await mutateAsync({ customer_id: data.customer_id })
      toast.success("This design now has a customer. Updates about it will reach them.")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Could not set the customer on this design.")
    }
  })

  const remove = async () => {
    try {
      await mutateAsync({ customer_id: null })
      /*
       * Says what it COSTS, not just what happened. Detaching is the switch
       * that makes every future update about this design go nowhere, and it
       * does so without any further sign.
       */
      toast.success("Customer removed. Updates about this design will now reach nobody.")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Could not remove the customer.")
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
                {customer.email} — updates about this design go here
              </Text>
            </div>
          ) : (
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              No customer is linked, so every update about this design — production
              started, production complete, materials delivered — reaches nobody,
              and says nothing about it.
            </Text>
          )}

          <Form.Field
            control={form.control}
            name="customer_id"
            render={({ field: { value, onChange, ...rest } }) => (
              <Form.Item>
                <Form.Label>Customer</Form.Label>
                <Form.Control>
                  {/*
                    `onSearchValueChange` drives the SERVER query rather than
                    filtering a fixed array — there is no bounded list of
                    customers to hold in memory, and a combobox that filtered
                    only what it was handed would silently stop at whatever
                    first page it loaded.
                  */}
                  <Combobox
                    {...rest}
                    options={options}
                    value={value}
                    onChange={(next) => onChange((next as string) || "")}
                    searchValue={search}
                    onSearchValueChange={setSearch}
                    allowClear
                    placeholder="Search customers by name or email"
                    noResultsPlaceholder={
                      <Text size="small" leading="compact" className="text-ui-fg-subtle">
                        {searching ? "Searching…" : "No customers match that."}
                      </Text>
                    }
                  />
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
                Remove customer
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
