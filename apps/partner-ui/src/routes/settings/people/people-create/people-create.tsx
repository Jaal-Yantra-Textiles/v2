import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { z as zod } from "@medusajs/framework/zod"

import { Form } from "../../../../components/common/form"
import { RouteFocusModal, useRouteModal } from "../../../../components/modals"
import { KeyboundForm } from "../../../../components/utilities/keybound-form"
import { useMe } from "../../../../hooks/api/users"

const CreatePersonSchema = zod.object({
  first_name: zod.string().min(1, "First name is required"),
  last_name: zod.string().min(1, "Last name is required"),
  email: zod.string().email("Invalid email"),
  role: zod.string().optional(),
})

type CreatePersonValues = zod.infer<typeof CreatePersonSchema>

type StoredPerson = CreatePersonValues & {
  id: string
  created_at: string
}

export const SettingsPeopleCreate = () => {
  return (
    <RouteFocusModal>
      <CreatePersonForm />
    </RouteFocusModal>
  )
}

const CreatePersonForm = () => {
  const { user } = useMe()
  const partnerId = user?.partner_id
  const { handleSuccess } = useRouteModal()

  const storageKey = partnerId ? `partner_people_${partnerId}` : null

  const form = useForm<CreatePersonValues>({
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      role: "member",
    },
    resolver: zodResolver(CreatePersonSchema),
  })

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!storageKey) return

    const next: StoredPerson = {
      ...values,
      id: `local_${Date.now()}`,
      created_at: new Date().toISOString(),
    }

    const raw = localStorage.getItem(storageKey)
    const current = raw ? (JSON.parse(raw) as StoredPerson[]) : []
    localStorage.setItem(storageKey, JSON.stringify([next, ...current]))

    toast.success("Person added")
    handleSuccess("..")
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col items-center overflow-y-auto">
            <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">
              <div>
                <Heading>Add Person</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Add a new team member.
                </Text>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Form.Field
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>First name</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Last name</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label>Email</Form.Label>
                      <Form.Control>
                        <Input {...field} type="email" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <Form.Item className="md:col-span-2">
                      <Form.Label>Role</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="member" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
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
              disabled={!partnerId}
            >
              Create
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
