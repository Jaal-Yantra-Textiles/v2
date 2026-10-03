import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, Select, toast } from "@medusajs/ui"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { z as zod } from "@medusajs/framework/zod"

import { Form } from "../../../../../components/common/form"
import { RouteDrawer, useRouteModal } from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import {
  PartnerUser,
  usePhonePinStatus,
  useSetPhonePin,
  useUpdateMe,
} from "../../../../../hooks/api/users"
import { languages } from "../../../../../i18n/languages"
import { extractErrorMessage } from "../../../../../lib/extract-error-message"

type EditProfileProps = {
  user: PartnerUser
  // usageInsights: boolean
}

const makeEditProfileSchema = (t: TFunction) =>
  zod
  .object({
    first_name: zod.string().optional(),
    last_name: zod.string().optional(),
    phone: zod.string().optional(),
    // Phone login PIN (#2320). Blank = leave the current PIN alone.
    pin: zod
      .string()
      .regex(/^(\d{6})?$/, { message: t("profile.edit.pinErrors.digits") })
      .optional(),
    pin_confirm: zod.string().optional(),
    language: zod.string(),
    // usage_insights: zod.boolean(),
  })
  .refine((v) => !v.pin || v.pin === v.pin_confirm, {
    path: ["pin_confirm"],
    message: t("profile.edit.pinErrors.mismatch"),
  })
  .refine((v) => !v.pin || !!v.phone?.trim(), {
    path: ["phone"],
    message: t("profile.edit.pinErrors.needsPhone"),
  })

const resolveInitialLanguage = (
  user: PartnerUser,
  currentI18nLanguage: string
) => {
  const candidate = user.preferred_language || currentI18nLanguage
  return (
    languages.find((lang) => lang.code === candidate)?.code ?? "en"
  )
}

export const EditProfileForm = ({ user }: EditProfileProps) => {
  const { t, i18n } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const schema = useMemo(() => makeEditProfileSchema(t), [t])
  const form = useForm<zod.infer<ReturnType<typeof makeEditProfileSchema>>>({
    defaultValues: {
      first_name: user.first_name ?? "",
      last_name: user.last_name ?? "",
      phone: user.phone ?? "",
      pin: "",
      pin_confirm: "",
      language: resolveInitialLanguage(user, i18n.language),
      // usage_insights: usageInsights,
    },
    resolver: zodResolver(schema),
  })

  const { mutateAsync, isPending } = useUpdateMe()
  const { mutateAsync: setPin, isPending: isSettingPin } = useSetPhonePin()
  const { data: pinStatus } = usePhonePinStatus()

  const handleSubmit = form.handleSubmit(async (values) => {
    await mutateAsync(
      {
        first_name: values.first_name,
        last_name: values.last_name,
        // Saved as E.164 by the backend, which also links it to phone login
        // (#2320) — or refuses a number another admin already uses.
        phone: values.phone?.trim() ? values.phone.trim() : null,
        preferred_language: values.language,
      },
      {
        onError: (error) => {
          toast.error(extractErrorMessage(error))
          return
        },
      }
    )

    // After the profile save: the PIN hangs off the phone just saved.
    if (values.pin) {
      await setPin(
        { pin: values.pin },
        {
          onError: (error) => {
            toast.error(extractErrorMessage(error))
          },
        }
      )
    }

    if (values.language && values.language !== i18n.language) {
      await i18n.changeLanguage(values.language)
    }

    toast.success(t("profile.toast.edit"))
    handleSuccess()
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex flex-1 flex-col">
        <RouteDrawer.Body>
          <div className="flex flex-col gap-y-8">
            <div className="grid grid-cols-2 gap-4">
              <Form.Field
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.firstName")}</Form.Label>
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
                    <Form.Label>{t("fields.lastName")}</Form.Label>
                    <Form.Control>
                      <Input {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
            <Form.Field
              control={form.control}
              name="phone"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>{t("fields.phone")}</Form.Label>
                  <Form.Control>
                    <Input
                      {...field}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+91 98765 43210"
                    />
                  </Form.Control>
                  <Form.Hint>{t("profile.edit.phoneHint")}</Form.Hint>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <div className="flex flex-col gap-y-2">
              <div className="grid grid-cols-2 gap-4">
                <Form.Field
                  control={form.control}
                  name="pin"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>
                        {pinStatus?.pin_set
                          ? t("profile.edit.newPinLabel")
                          : t("profile.edit.pinLabel")}
                      </Form.Label>
                      <Form.Control>
                        <Input
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))}
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          maxLength={6}
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  control={form.control}
                  name="pin_confirm"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>{t("profile.edit.pinConfirmLabel")}</Form.Label>
                      <Form.Control>
                        <Input
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))}
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          maxLength={6}
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
              <Form.Hint>
                {pinStatus?.pin_set
                  ? t("profile.edit.pinHintSet")
                  : t("profile.edit.pinHintUnset")}
              </Form.Hint>
            </div>
            <Form.Field
              control={form.control}
              name="language"
              render={({ field: { onChange, ref, ...field } }) => (
                <Form.Item>
                  <Form.Label>{t("profile.fields.languageLabel")}</Form.Label>
                  <Form.Control>
                    <Select {...field} onValueChange={onChange}>
                      <Select.Trigger ref={ref}>
                        <Select.Value
                          placeholder={t("profile.edit.languagePlaceholder")}
                        />
                      </Select.Trigger>
                      <Select.Content>
                        {languages.map((lang) => (
                          <Select.Item key={lang.code} value={lang.code}>
                            {lang.display_name}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </Form.Control>
                  <Form.Hint>{t("profile.edit.languageHint")}</Form.Hint>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            {/* TODO: Do we want to implement usage insights in V2? */}
            {/* <Form.Field
              control={form.control}
              name="usage_insights"
              render={({ field: { value, onChange, ...rest } }) => (
                <Form.Item>
                  <div className="flex items-center justify-between">
                    <Form.Label>
                      {t("profile.fields.usageInsightsLabel")}
                    </Form.Label>
                    <Form.Control>
                      <Switch dir="ltr"
                        className="rtl:rotate-180"
                        {...rest}
                        checked={value}
                        onCheckedChange={onChange}
                      />
                    </Form.Control>
                  </div>
                  <Form.Hint>
                    <span>
                      <Trans
                        i18nKey="profile.edit.usageInsightsHint"
                        components={[
                          <a
                            key="hint-link"
                            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover transition-fg underline"
                            // TODO change link once docs are public
                            href="https://medusa-resources-git-docs-v2-medusajs.vercel.app/resources/usage#admin-analytics"
                            target="_blank"
                            rel="noopener noreferrer"
                          />,
                        ]}
                      />
                    </span>
                  </Form.Hint>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            /> */}
          </div>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending || isSettingPin}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
