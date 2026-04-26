import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { Badge, Button, Checkbox, Heading, Input, Select, Switch, Text, toast } from "@medusajs/ui"

import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { KeyboundForm } from "../../../components/utilitites/key-bound-form"
import { useRouteModal } from "../../../components/modal/use-route-modal"
import { Form } from "../../../components/common/form"
import { useCreatePartnerWithAdmin } from "../../../hooks/api/partners-admin"
import { usePersonTypes } from "../../../hooks/api/persontype"

// Use literal tuples to avoid TS enum widening issues with z.enum
const ROLE_ENUM = ["owner", "admin", "manager"] as const
const STATUS_ENUM = ["active", "inactive", "pending"] as const
const WORKSPACE_TYPE_ENUM = ["seller", "manufacturer", "individual"] as const

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
    workspace_type: z.enum(WORKSPACE_TYPE_ENUM).default("manufacturer"),
  }),
  admin: z.object({
    email: z.string().email("Invalid email"),
    first_name: z.string().min(1, "First name is required"),
    last_name: z.string().min(1, "Last name is required"),
    phone: z.string().optional(),
    role: z.enum(ROLE_ENUM).default("owner"),
  }),
  // Person type IDs to link after creation (only for individual workspace type)
  person_type_ids: z.array(z.string()).optional().default([]),
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
        workspace_type: "manufacturer",
      },
      admin: {
        email: "",
        first_name: "",
        last_name: "",
        phone: "",
        role: "owner",
      },
      person_type_ids: [] as string[],
      auth_identity_id: undefined,
    },
    resolver: zodResolver(partnerAdminSchema),
    mode: "onChange",
  })

  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useCreatePartnerWithAdmin()

  const workspaceType = useWatch({ control: form.control, name: "partner.workspace_type" })
  const { personTypes } = usePersonTypes({ limit: 100 })

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
          workspace_type: validated.partner.workspace_type,
        },
        admin: {
          email: validated.admin.email,
          first_name: validated.admin.first_name,
          last_name: validated.admin.last_name,
          phone: validated.admin.phone || undefined,
          role: validated.admin.role,
        },
        auth_identity_id: validated.auth_identity_id,
      }

      await mutateAsync(payload, {
        onSuccess: async ({ partner }) => {
          // Link person types if workspace_type is individual
          if (
            validated.partner.workspace_type === "individual" &&
            validated.person_type_ids &&
            validated.person_type_ids.length > 0
          ) {
            try {
              const { sdk } = await import("../../../lib/config.js")
              await sdk.client.fetch(`/admin/partners/${partner.id}/person-types`, {
                method: "POST",
                body: { person_type_ids: validated.person_type_ids },
              })
            } catch (e) {
              console.error("Failed to link person types", e)
            }
          }
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
                        <Select.Trigger>
                          <Select.Value placeholder="Select status" />
                        </Select.Trigger>
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

              <Form.Field
                control={form.control}
                name="partner.workspace_type"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{"Workspace Type"}</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select workspace type" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="seller">Seller</Select.Item>
                          <Select.Item value="manufacturer">Manufacturer</Select.Item>
                          <Select.Item value="individual">Individual</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>

            {workspaceType === "individual" && personTypes && personTypes.length > 0 && (
              <div>
                <Heading level="h2" className="text-lg md:text-xl">{"Person Types"}</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {"Select the roles this individual performs"}
                </Text>
                <div className="mt-3 flex flex-wrap gap-2">
                  {personTypes.map((pt: any) => {
                    const selectedIds = form.watch("person_type_ids") || []
                    const isSelected = selectedIds.includes(pt.id)
                    return (
                      <button
                        key={pt.id}
                        type="button"
                        onClick={() => {
                          const current = form.getValues("person_type_ids") || []
                          if (current.includes(pt.id)) {
                            form.setValue(
                              "person_type_ids",
                              current.filter((id: string) => id !== pt.id)
                            )
                          } else {
                            form.setValue("person_type_ids", [...current, pt.id])
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-all ${
                          isSelected
                            ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                            : "border-ui-border-base hover:shadow-elevation-card-hover"
                        }`}
                      >
                        {pt.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

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
                        <Select.Trigger>
                          <Select.Value placeholder="Select role" />
                        </Select.Trigger>
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
                    <Form.Label>{"First Name"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" required {...field} />
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
                    <Form.Label>{"Last Name"}</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" required {...field} />
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
