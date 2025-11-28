import { Button, Heading, Input, Textarea, toast, Text, Select } from "@medusajs/ui"
import { RouteFocusModal } from "../modal/route-focus-modal" // Assuming path based on task-template
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useCreateSocialPlatform } from "../../hooks/api/social-platforms" // Adjusted path

import { KeyboundForm } from "../utilitites/key-bound-form"
import { Form } from "../common/form"
import { useRouteModal } from "../modal/use-route-modal"

const CreateSocialPlatformSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  base_url: z.string().url("Must be a valid URL").optional().or(z.literal('')),
  category: z.enum(["social", "payment", "shipping", "email", "sms", "analytics", "crm", "storage", "communication", "authentication", "other"]).optional(),
  auth_type: z.enum(["oauth2", "oauth1", "api_key", "bearer", "basic"]).optional(),
  status: z.enum(["active", "inactive", "error", "pending"]).optional(),
})

type CreateSocialPlatformForm = z.infer<typeof CreateSocialPlatformSchema>

export const CreateSocialPlatformComponent = () => {
  const { handleSuccess } = useRouteModal();
  const form = useForm<CreateSocialPlatformForm>({
    resolver: zodResolver(CreateSocialPlatformSchema),
    defaultValues: {
      name: "",
      description: "",
      base_url: "",
      category: "social",
      auth_type: "oauth2",
      status: "pending",
    },
  })

  const { mutateAsync, isPending } = useCreateSocialPlatform()

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await mutateAsync(data, {
        onSuccess: ({ socialPlatform}) => { 
            toast.success("External Platform created successfully")
            handleSuccess(`/settings/external-platforms/${socialPlatform.id}`) 
        }
      })
      // Navigate back to the list page
    } catch (e: any) {
      toast.error(e.message)
    }
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
            >
              Save
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create External Platform</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Connect a new external platform (social media, analytics, CRM, etc.) to your system.
              </Text>
            </div>
            
            <div className="grid grid-cols-1 gap-4 md:grid-cols-1"> {/* Changed to 1 column for simplicity, adjust if needed */}
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Name</Form.Label>
                    <Form.Control>
                      <Input {...field} placeholder="e.g. Facebook, Instagram" />
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
                      <Textarea {...field} placeholder="e.g. Official Facebook page for customer engagement" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="base_url"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Base URL</Form.Label>
                    <Form.Control>
                      <Input type="url" {...field} placeholder="https://api.platform.com" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="category"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Category</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select category" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="social">Social Media</Select.Item>
                          <Select.Item value="payment">Payment</Select.Item>
                          <Select.Item value="shipping">Shipping</Select.Item>
                          <Select.Item value="email">Email</Select.Item>
                          <Select.Item value="sms">SMS</Select.Item>
                          <Select.Item value="analytics">Analytics</Select.Item>
                          <Select.Item value="crm">CRM</Select.Item>
                          <Select.Item value="storage">Storage</Select.Item>
                          <Select.Item value="communication">Communication</Select.Item>
                          <Select.Item value="authentication">Authentication</Select.Item>
                          <Select.Item value="other">Other</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="auth_type"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Authentication Type</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select authentication type" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="oauth2">OAuth 2.0</Select.Item>
                          <Select.Item value="oauth1">OAuth 1.0</Select.Item>
                          <Select.Item value="api_key">API Key</Select.Item>
                          <Select.Item value="bearer">Bearer Token</Select.Item>
                          <Select.Item value="basic">Basic Auth</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Status</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select status" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="pending">Pending</Select.Item>
                          <Select.Item value="active">Active</Select.Item>
                          <Select.Item value="inactive">Inactive</Select.Item>
                          <Select.Item value="error">Error</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

export default CreateSocialPlatformComponent
