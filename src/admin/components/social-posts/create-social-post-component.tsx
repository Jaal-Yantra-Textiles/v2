import { Button, Heading, Input, Select, Text } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useCreateSocialPost } from "../../hooks/api/social-posts"
import { useSocialPlatforms } from "../../hooks/api/social-platforms"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { Form } from "../common/form"
import { useRouteModal } from "../modal/use-route-modal"

const CreateSocialPostSchema = z.object({
  name: z.string().min(1, "Name is required"),
  platform_id: z.string().min(1, "Platform is required"),
})

type CreateSocialPostForm = z.infer<typeof CreateSocialPostSchema>

export const CreateSocialPostComponent = () => {
  const { handleSuccess } = useRouteModal()

  const form = useForm<CreateSocialPostForm>({
    resolver: zodResolver(CreateSocialPostSchema),
  })

  const { mutateAsync, isPending } = useCreateSocialPost()
  const {
    socialPlatforms = [],
    isLoading: isPlatformsLoading,
  } = useSocialPlatforms()

  const onSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(data, {
      onSuccess: ({ socialPost }) => {
        handleSuccess(`/social-posts/${socialPost.id}`)
      },
    })
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create Social Post</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Define a new social post for your brand.
              </Text>
            </div>

            
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Name</Form.Label>
                    <Form.Control>
                      <Input {...field} placeholder="e.g. Summer Sale Post" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="platform_id"
                render={({ field: { value, onChange, ...rest } }) => (
                  <Form.Item>
                    <Form.Label>Platform</Form.Label>
                    <Form.Control>
                      <Select value={value} onValueChange={onChange} {...rest} disabled={isPlatformsLoading}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select platform" />
                        </Select.Trigger>
                        <Select.Content>
                          {socialPlatforms.map((platform) => (
                            <Select.Item key={platform.id} value={platform.id}>
                              {platform.name}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex justify-end items-center gap-x-2 px-6">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" variant="primary" type="submit" isLoading={isPending}>
              Save
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

export default CreateSocialPostComponent
