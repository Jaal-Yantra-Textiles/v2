import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import * as zod from "zod"

import { Form } from "../../../../components/common/form"
import { RouteFocusModal } from "../../../../components/modals"
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
  const navigate = useNavigate()
  const { user } = useMe()
  const partnerId = user?.partner_id

  const storageKey = useMemo(() => {
    return partnerId ? `partner_people_${partnerId}` : null
  }, [partnerId])

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
    if (!storageKey) {
      return
    }

    const now = new Date().toISOString()
    const next: StoredPerson = {
      ...values,
      id: `local_${Date.now()}`,
      created_at: now,
    }

    const raw = localStorage.getItem(storageKey)
    const current = raw ? (JSON.parse(raw) as StoredPerson[]) : []
    localStorage.setItem(storageKey, JSON.stringify([next, ...(current || [])]))

    form.reset()

    navigate("..", { replace: true, state: { isSubmitSuccessful: true } })
  })

  return (
    <RouteFocusModal>
      <RouteFocusModal.Form form={form}>
        <div className="flex h-full flex-col overflow-hidden">
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

                {!partnerId && (
                  <Text size="small" className="text-ui-fg-subtle">
                    Missing partner context.
                  </Text>
                )}

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

                <div className="flex items-center justify-end">
                  <Button
                    size="small"
                    variant="primary"
                    type="button"
                    onClick={handleSubmit}
                    disabled={!partnerId}
                  >
                    Create
                  </Button>
                </div>
              </div>
            </div>
          </RouteFocusModal.Body>
        </div>
      </RouteFocusModal.Form>
    </RouteFocusModal>
  )
}
