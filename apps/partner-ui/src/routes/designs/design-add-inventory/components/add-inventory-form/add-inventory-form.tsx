import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"

import { Form } from "../../../../../components/common/form"
import { RouteFocusModal, useRouteModal } from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useLinkPartnerDesignInventory } from "../../../../../hooks/api/partner-design-inventory"
import { useInventoryItems } from "../../../../../hooks/api/inventory"

const AddInventorySchema = z.object({
  inventoryId: z.string().min(1, "Select an inventory item"),
  plannedQuantity: z.coerce.number().int().positive().optional(),
})
type AddInventorySchema = z.infer<typeof AddInventorySchema>

type Props = { designId: string }

export const AddInventoryForm = ({ designId }: Props) => {
  const { handleSuccess } = useRouteModal()
  const { inventory_items: available = [], isLoading } = useInventoryItems({
    limit: 200,
    // @ts-expect-error partner route accepts fields passthrough
    fields: "id,title,sku",
  }) as any

  const form = useForm<AddInventorySchema>({
    defaultValues: { inventoryId: "", plannedQuantity: undefined },
    resolver: zodResolver(AddInventorySchema),
  })

  const { mutateAsync, isPending } = useLinkPartnerDesignInventory(designId)

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(
      {
        inventoryItems: [
          {
            inventoryId: data.inventoryId,
            plannedQuantity: data.plannedQuantity,
          },
        ],
      },
      {
        onSuccess: () => {
          toast.success("Material added")
          handleSuccess()
        },
        onError: (e) => toast.error(e.message),
      }
    )
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        className="flex h-full flex-col overflow-hidden"
        onSubmit={handleSubmit}
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto">
          <div className="flex w-full max-w-[640px] flex-col gap-y-8 px-2 py-16">
            <div className="flex flex-col gap-y-1">
              <Heading>Add material</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Link an inventory item this design consumes.
              </Text>
            </div>

            <Form.Field
              control={form.control}
              name="inventoryId"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Inventory item</Form.Label>
                  <Form.Control>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isLoading}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Select an item" />
                      </Select.Trigger>
                      <Select.Content>
                        {available.map((it: any) => (
                          <Select.Item key={it.id} value={it.id}>
                            {it.title || it.id}
                            {it.sku ? ` — ${it.sku}` : ""}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="plannedQuantity"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Planned quantity</Form.Label>
                  <Form.Control>
                    <Input
                      type="number"
                      min={1}
                      placeholder="e.g. 12"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" size="small">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              Add
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
