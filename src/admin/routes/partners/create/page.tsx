import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button, Heading, Input, Select, Switch, Text, toast } from "@medusajs/ui"

import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { KeyboundForm } from "../../../components/utilitites/key-bound-form"
import { useRouteModal } from "../../../components/modal/use-route-modal"
import { Form } from "../../../components/common/form"
import { useCreatePartnerWithAdmin } from "../../../hooks/api/partners-admin"

// Use literal tuples to avoid TS enum widening issues with z.enum
const ROLE_ENUM = ["owner", "admin", "manager"] as const
const STATUS_ENUM = ["active", "inactive", "pending"] as const

const partnerAdminSchema = z.object({
  partner: z.object({
    name: z.string().min(1, "Name is required"),
    handle: z.string().optional(),
    logo: z
      .string()
      .url("Must be a valid URL")
      .optional()
      .or(z.literal(""))
      .transform((v) => (v === "" ? undefined : v)),
    status: z.enum(STATUS_ENUM).default("pending"),
    // Mark optional with default to align resolver inferred type
    is_verified: z.boolean().optional().default(false),
  }),
  admin: z.object({
    email: z.string().email("Invalid email"),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    role: z.enum(ROLE_ENUM).default("owner"),
  }),
  // Optional: allow passing auth identity if already created
  auth_identity_id: z.string().optional(),
})


const CreatePartnerComponent = () => {
  const form = useForm({
    defaultValues: {
      partner: {
        name: "",
        handle: "",
        logo: "",
        status: "pending",
        is_verified: false,
      },
      admin: {
        email: "",
        first_name: "",
        last_name: "",
        phone: "",
        role: "owner",
      },
      auth_identity_id: undefined,
    },
    resolver: zodResolver(partnerAdminSchema),
    mode: "onChange",
  })

  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useCreatePartnerWithAdmin()

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      const validated = partnerAdminSchema.parse(data)
      const payload = {
        partner: {
          name: validated.partner.name,
          handle: validated.partner.handle || undefined,
          logo: validated.partner.logo,
          status: validated.partner.status,
          is_verified: validated.partner.is_verified,
        },
        admin: {
          email: validated.admin.email,
          first_name: validated.admin.first_name || undefined,
          last_name: validated.admin.last_name || undefined,
          phone: validated.admin.phone || undefined,
          role: validated.admin.role,
        },
        auth_identity_id: validated.auth_identity_id,
      }

      await mutateAsync(payload, {
        onSuccess: ({ partner }) => {
          toast.success(`Partner ${partner.name} created`)
          handleSuccess(`/partners/${partner.id}`)
        },
        onError: (err: any) => {
          toast.error(err.message)
        },
      })
    } catch (e) {
      if (e instanceof z.ZodError) {
        const first = e.errors[0]
        toast.error(`${first.path.join(".")}: ${first.message}`)
      } else {
        toast.error("Unexpected error")
        console.error(e)
      }
    }
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 md:py-16 px-4 md:px-6">
          <div className="flex w-full max-w-[720px] flex-col gap-y-6 md:gap-y-8">
            <div>
              <Heading className="text-xl md:text-2xl">{"Create a new Partner"}</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                {"This will also create the primary partner admin"}
              </Text>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="partner.name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{"Partner Name"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="partner.handle"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{"Handle"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" placeholder="acme" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="partner.logo"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{"Logo URL"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" placeholder="https://..." {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="partner.status"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{"Status"}</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger />
                        <Select.Content>
                          <Select.Item value="active">Active</Select.Item>
                          <Select.Item value="inactive">Inactive</Select.Item>
                          <Select.Item value="pending">Pending</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="partner.is_verified"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{"Verified"}</Form.Label>
                    <Form.Control>
                      <div className="flex items-center gap-2">
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                        <Text size="small" className="text-ui-fg-subtle">{"Mark as verified"}</Text>
                      </div>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>

            <div>
              <Heading level="h2" className="text-lg md:text-xl">{"Admin Details"}</Heading>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="admin.email"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{"Admin Email"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="admin.role"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{"Role"}</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger />
                        <Select.Content>
                          <Select.Item value="owner">Owner</Select.Item>
                          <Select.Item value="admin">Admin</Select.Item>
                          <Select.Item value="manager">Manager</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="admin.first_name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{"First Name"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="admin.last_name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{"Last Name"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="admin.phone"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{"Phone"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer className="px-4 py-3 md:px-6 md:py-4">
          <div className="flex flex-col-reverse sm:flex-row justify-end items-center gap-y-2 gap-x-2 w-full">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary" className="w-full sm:w-auto">
                {"Cancel"}
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" variant="primary" type="submit" isLoading={isPending} className="w-full sm:w-auto">
              {"Create"}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

const CreatePartnerModal = () => {
  return (
    <RouteFocusModal>
      <CreatePartnerComponent />
    </RouteFocusModal>
  )
}

export default CreatePartnerModal
