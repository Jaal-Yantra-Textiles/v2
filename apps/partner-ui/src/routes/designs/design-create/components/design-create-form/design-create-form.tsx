import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Select, Textarea, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"

import { Form } from "../../../../../components/common/form"
import { RouteFocusModal, useRouteModal } from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useCreatePartnerDesign } from "../../../../../hooks/api/partner-designs"
import { CreateDesignSchema } from "./schema"

const DESIGN_TYPES = ["Original", "Derivative", "Custom", "Collaboration"] as const
const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const
const STATUSES = [
  "Conceptual",
  "In_Development",
  "Technical_Review",
  "Sample_Production",
  "Revision",
  "Approved",
  "On_Hold",
  "Commerce_Ready",
] as const

export function DesignCreateForm() {
  const { handleSuccess } = useRouteModal()
  const form = useForm<CreateDesignSchema>({
    defaultValues: {
      name: "",
      description: "",
      design_type: "Original",
      priority: "Medium",
      status: "Conceptual",
      designer_notes: "",
    },
    resolver: zodResolver(CreateDesignSchema),
  })

  const { mutateAsync, isPending } = useCreatePartnerDesign()

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(data, {
      onSuccess: ({ design }) => {
        toast.success("Design created")
        handleSuccess(`/designs/${design.id}`)
      },
      onError: (e) => toast.error(e.message),
    })
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        className="flex h-full flex-col overflow-hidden"
        onSubmit={handleSubmit}
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">
            <Heading>Create design</Heading>

            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Name</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="e.g. Spring Jacket" />
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
                    <Textarea {...field} placeholder="What is this design?" />
                  </Form.Control>
                </Form.Item>
              )}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
                name="status"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Status</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select" />
                        </Select.Trigger>
                        <Select.Content>
                          {STATUSES.map((s) => (
                            <Select.Item key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                  </Form.Item>
                )}
              />
            </div>

            <Form.Field
              control={form.control}
              name="designer_notes"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Designer notes</Form.Label>
                  <Form.Control>
                    <Textarea {...field} placeholder="Internal notes" />
                  </Form.Control>
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
              Create
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
