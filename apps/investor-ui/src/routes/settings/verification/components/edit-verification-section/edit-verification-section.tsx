import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import * as zod from "zod"

import { Form } from "../../../../../components/common/form"
import { RouteDrawer, useRouteModal } from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useUpdateMe } from "../../../../../hooks/api/users"

type InvestorData = {
  id: string
  country_code?: string | null
  pan_number?: string | null
  aadhar_number?: string | null
  international_id_number?: string | null
  id_type?: string | null
}

type EditVerificationSectionProps = {
  investor: InvestorData
}

const PanRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
const AadharRegex = /^\d{12}$/

export const EditVerificationSection = ({
  investor,
}: EditVerificationSectionProps) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()

  const isIndia = investor.country_code === "IN"

  const EditVerificationSchema = zod.object({
    pan_number: isIndia
      ? zod
          .string()
          .regex(PanRegex, t("verification.validation.panFormat"))
          .nullable()
          .optional()
      : zod.string().nullable().optional(),
    aadhar_number: isIndia
      ? zod
          .string()
          .regex(AadharRegex, t("verification.validation.aadharFormat"))
          .nullable()
          .optional()
      : zod.string().nullable().optional(),
    international_id_number: !isIndia
      ? zod.string().min(1, t("verification.validation.required")).nullable().optional()
      : zod.string().nullable().optional(),
    id_type: !isIndia
      ? zod.enum(["pan", "aadhar", "international"]).nullable().optional()
      : zod.enum(["pan", "aadhar", "international"]).nullable().optional(),
  })

  const form = useForm<zod.infer<typeof EditVerificationSchema>>({
    defaultValues: {
      pan_number: investor.pan_number ?? "",
      aadhar_number: investor.aadhar_number ?? "",
      international_id_number: investor.international_id_number ?? "",
      id_type: (investor.id_type as any) ?? "international",
    },
    resolver: zodResolver(EditVerificationSchema),
  })

  const { mutateAsync, isPending } = useUpdateMe()

  const handleSubmit = form.handleSubmit(async (values) => {
    const payload: Record<string, any> = {}

    if (isIndia) {
      payload.pan_number = values.pan_number || null
      payload.aadhar_number = values.aadhar_number || null
      payload.international_id_number = null
      payload.id_type = values.pan_number
        ? "pan"
        : values.aadhar_number
          ? "aadhar"
          : null
    } else {
      payload.international_id_number = values.international_id_number || null
      payload.pan_number = null
      payload.aadhar_number = null
      payload.id_type = "international"
    }

    await mutateAsync(payload, {
      onError: (error) => {
        toast.error(error.message)
      },
      onSuccess: () => {
        toast.success(t("verification.toast.update"))
        handleSuccess()
      },
    })
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex flex-1 flex-col">
        <RouteDrawer.Body>
          <div className="flex flex-col gap-y-8">
            {isIndia ? (
              <>
                <Form.Field
                  control={form.control}
                  name="pan_number"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>{t("verification.panCard")}</Form.Label>
                      <Form.Hint>{t("verification.panHint")}</Form.Hint>
                      <Form.Control>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="ABCDE1234F"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  control={form.control}
                  name="aadhar_number"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>{t("verification.aadharCard")}</Form.Label>
                      <Form.Hint>{t("verification.aadharHint")}</Form.Hint>
                      <Form.Control>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="123456789012"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </>
            ) : (
              <Form.Field
                control={form.control}
                name="international_id_number"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>
                      {t("verification.internationalId")}
                    </Form.Label>
                    <Form.Hint>
                      {t("verification.internationalIdHint")}
                    </Form.Hint>
                    <Form.Control>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        placeholder={t("verification.internationalIdPlaceholder")}
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            )}
          </div>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
