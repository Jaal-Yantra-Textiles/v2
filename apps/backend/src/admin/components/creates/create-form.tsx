import { useForm } from "react-hook-form"
import { z } from "@medusajs/framework/zod"
import { Button, Heading, Input, Text, toast, Select } from "@medusajs/ui"

import { useRouteModal } from "../modal/use-route-modal"
import { useCreateForm } from "../../hooks/api/forms"
import { Form } from "../common/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { RouteFocusModal } from "../modal/route-focus-modal"

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  handle: z.string().min(1, "Handle is required"),
  domain: z.string().min(1, "Domain is required"),
  status: z.enum(["draft", "published", "archived"]),
  description: z.string().optional(),
  submit_label: z.string().optional(),
  success_message: z.string().optional(),
})

type FormCreateData = z.infer<typeof formSchema>

export const CreateFormComponent = () => {
  const form = useForm<FormCreateData>({
    defaultValues: {
      title: "",
      handle: "",
      domain: "",
      status: "draft",
      description: "",
      submit_label: "",
      success_message: "",
    },
    resolver: zodResolver(formSchema),
  })

  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useCreateForm()

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(
      {
        title: data.title,
        handle: data.handle,
        domain: data.domain,
        status: data.status,
        description: data.description || undefined,
        submit_label: data.submit_label || undefined,
        success_message: data.success_message || undefined,
      },
      {
        onSuccess: ({ form: created }) => {
          toast.success(`Form created successfully, ${created.title}`)
          handleSuccess(`/settings/forms/${created.id}`)
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" variant="primary" type="submit" isLoading={isPending}>
              Create
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Define a New Form</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Create a form for a specific website domain.
              </Text>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="title"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Title</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="handle"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Handle</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="domain"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Domain</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="status"
                render={({ field: { value, onChange } }) => (
                  <Form.Item>
                    <Form.Label>Status</Form.Label>
                    <Form.Control>
                      <Select value={value} onValueChange={onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select status" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="draft">Draft</Select.Item>
                          <Select.Item value="published">Published</Select.Item>
                          <Select.Item value="archived">Archived</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="submit_label"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Submit label</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="success_message"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Success message</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <div className="md:col-span-2">
                <Form.Field
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>Description</Form.Label>
                      <Form.Control>
                        <Input autoComplete="off" {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
