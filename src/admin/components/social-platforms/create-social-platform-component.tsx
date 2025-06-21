import { Button, Heading, Input, Textarea, toast, Text } from "@medusajs/ui"
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
  url: z.string().url("Must be a valid URL").optional().or(z.literal('')), // Allow empty string
})

type CreateSocialPlatformForm = z.infer<typeof CreateSocialPlatformSchema>

export const CreateSocialPlatformComponent = () => {
  const { handleSuccess } = useRouteModal();
  const form = useForm<CreateSocialPlatformForm>({
    resolver: zodResolver(CreateSocialPlatformSchema),
  })

  const { mutateAsync, isPending } = useCreateSocialPlatform()

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await mutateAsync(data, {
        onSuccess: ({ socialPlatform}) => { 
            toast.success("Social Platform created successfully")
            handleSuccess(`/settings/social-platforms/${socialPlatform.id}`) 
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
              <Heading>Create Social Platform</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Define a new social platform for your brand.
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
                name="url"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>URL</Form.Label>
                    <Form.Control>
                      <Input type="url" {...field} placeholder="https://facebook.com/yourbrand" />
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
