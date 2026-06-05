import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, Select, Textarea, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"

import { Form } from "../../../../../components/common/form"
import { RouteDrawer, useRouteModal } from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import {
  PartnerDesign,
  useUpdatePartnerDesign,
} from "../../../../../hooks/api/partner-designs"
import { CreateDesignSchema } from "../../../design-create/components/design-create-form/schema"

const DESIGN_TYPES = ["Original", "Derivative", "Custom", "Collaboration"] as const
const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const

type Props = { design: PartnerDesign }

export const EditDesignForm = ({ design }: Props) => {
  const { handleSuccess } = useRouteModal()
  const form = useForm<CreateDesignSchema>({
    defaultValues: {
      name: design.name ?? "",
      description: design.description ?? "",
      design_type: (design.design_type as any) ?? "Original",
      priority: (design.priority as any) ?? "Medium",
      designer_notes: design.designer_notes ?? "",
    },
    resolver: zodResolver(CreateDesignSchema),
  })

  const { mutateAsync, isPending } = useUpdatePartnerDesign(design.id)

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(data, {
      onSuccess: () => {
        toast.success("Design updated")
        handleSuccess()
      },
      onError: (e) => toast.error(e.message),
    })
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex flex-1 flex-col">
        <RouteDrawer.Body>
          <div className="flex flex-col gap-y-4">
            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Name</Form.Label>
                  <Form.Control>
                    <Input {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="description"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Description</Form.Label>
                  <Form.Control>
                    <Textarea {...field} />
                  </Form.Control>
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="design_type"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Type</Form.Label>
                  <Form.Control>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <Select.Trigger>
                        <Select.Value placeholder="Select" />
                      </Select.Trigger>
                      <Select.Content>
                        {DESIGN_TYPES.map((t) => (
                          <Select.Item key={t} value={t}>
                            {t}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </Form.Control>
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="priority"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Priority</Form.Label>
                  <Form.Control>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <Select.Trigger>
                        <Select.Value placeholder="Select" />
                      </Select.Trigger>
                      <Select.Content>
                        {PRIORITIES.map((p) => (
                          <Select.Item key={p} value={p}>
                            {p}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </Form.Control>
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="designer_notes"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Designer notes</Form.Label>
                  <Form.Control>
                    <Textarea {...field} />
                  </Form.Control>
                </Form.Item>
              )}
            />
          </div>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button variant="secondary" size="small">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button isLoading={isPending} type="submit" variant="primary" size="small">
              Save
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
