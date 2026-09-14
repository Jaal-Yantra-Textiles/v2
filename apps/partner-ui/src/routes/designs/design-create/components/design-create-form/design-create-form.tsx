import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Select, Textarea, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { Form } from "../../../../../components/common/form"
import { RouteFocusModal, useRouteModal } from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useCreatePartnerDesign } from "../../../../../hooks/api/partner-designs"
import { designStatusLabel, designTypeLabel, priorityLabel } from "../../../../../lib/design-labels"
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
  const { t } = useTranslation()
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
        toast.success(t("partner.designs.create.created"))
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
            <Heading>{t("partner.designs.create.heading")}</Heading>

            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("fields.name")}</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder={t("partner.designs.create.namePlaceholder")} />
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
                  <Form.Label optional>{t("fields.description")}</Form.Label>
                  <Form.Control>
                    <Textarea {...field} placeholder={t("partner.designs.create.descriptionPlaceholder")} />
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
                    <Form.Label optional>{t("fields.type")}</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder={t("general.select")} />
                        </Select.Trigger>
                        <Select.Content>
                          {DESIGN_TYPES.map((v) => (
                            <Select.Item key={v} value={v}>
                              {designTypeLabel(t, v)}
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
                    <Form.Label optional>{t("partner.designs.fields.priority")}</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder={t("general.select")} />
                        </Select.Trigger>
                        <Select.Content>
                          {PRIORITIES.map((v) => (
                            <Select.Item key={v} value={v}>
                              {priorityLabel(t, v)}
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
                    <Form.Label optional>{t("fields.status")}</Form.Label>
                    <Form.Control>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <Select.Trigger>
                          <Select.Value placeholder={t("general.select")} />
                        </Select.Trigger>
                        <Select.Content>
                          {STATUSES.map((v) => (
                            <Select.Item key={v} value={v}>
                              {designStatusLabel(t, v)}
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
                  <Form.Label optional>{t("partner.designs.fields.designerNotes")}</Form.Label>
                  <Form.Control>
                    <Textarea {...field} placeholder={t("partner.designs.create.designerNotesPlaceholder")} />
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
                {t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              {t("actions.create")}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}