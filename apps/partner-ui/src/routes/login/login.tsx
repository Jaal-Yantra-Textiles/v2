import { zodResolver } from "@hookform/resolvers/zod"
import { Alert, Button, Heading, Hint, Input, Select, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Trans, useTranslation } from "react-i18next"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { z as z } from "@medusajs/framework/zod"

import { Form } from "../../components/common/form"
import AvatarBox from "../../components/common/logo-box/avatar-box"
import {
  useResendPartnerVerification,
  useSignInWithEmailPass,
} from "../../hooks/api"
import { i18n } from "../../components/utilities/i18n"
import { languages } from "../../i18n/languages"
import { isFetchError } from "../../lib/is-fetch-error"
import { useExtension } from "../../providers/extension-provider"

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export const Login = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { getWidgets } = useExtension()

  const from = location.state?.from?.pathname || "/"

  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  const { mutateAsync, isPending } = useSignInWithEmailPass()
  const { mutateAsync: resend, isPending: isResending } =
    useResendPartnerVerification()

  // When set, the partner's email isn't verified yet — we show the
  // "verify your email" panel instead of the sign-in form. The password is
  // kept so "Resend" can mint a fresh actorless token.
  const [unverified, setUnverified] = useState<{
    email: string
    password: string
  } | null>(null)

  const handleSubmit = form.handleSubmit(async ({ email, password }) => {
    await mutateAsync(
      {
        email,
        password,
      },
      {
        onError: (error) => {
          if (isFetchError(error)) {
            if (error.status === 401) {
              form.setError("email", {
                type: "manual",
                message: error.message,
              })

              return
            }
          }

          form.setError("root.serverError", {
            type: "manual",
            message: error.message,
          })
        },
        onSuccess: (data) => {
          if (data.verificationRequired) {
            setUnverified({ email, password })
            return
          }
          navigate(from, { replace: true })
        },
      }
    )
  })

  const handleResend = async () => {
    if (!unverified) return
    try {
      const stillRequired = await resend(unverified)
      if (stillRequired) {
        toast.success(
          `Verification link sent to ${unverified.email}. Check your inbox.`
        )
      } else {
        // The identity is already verified — login no longer gates.
        toast.success("Your email is verified — you can sign in now.")
        setUnverified(null)
      }
    } catch {
      toast.error("Couldn't resend the verification email. Please try again.")
    }
  }

  const serverError = form.formState.errors?.root?.serverError?.message
  const validationError =
    form.formState.errors.email?.message ||
    form.formState.errors.password?.message

  return (
    <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center">
      <div className="m-4 flex w-full max-w-[280px] flex-col items-center">
        <AvatarBox />
        <div className="mb-4 flex flex-col items-center">
          <Heading>{t("login.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle text-center">
            {t("login.hint")}
          </Text>
        </div>
        {unverified ? (
          <div className="flex w-full flex-col gap-y-4">
            <Alert variant="warning" className="items-start p-3">
              <div className="flex flex-col gap-y-1">
                <Text size="small" weight="plus">
                  Your email isn't verified yet
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  We sent a verification link to{" "}
                  <span className="text-ui-fg-base font-medium">
                    {unverified.email}
                  </span>
                  . Open it to finish signing in, or resend it below.
                </Text>
              </div>
            </Alert>
            <Button
              className="w-full"
              variant="secondary"
              onClick={handleResend}
              isLoading={isResending}
            >
              Resend verification email
            </Button>
            <Button
              className="w-full"
              variant="transparent"
              onClick={() => setUnverified(null)}
            >
              Back to sign in
            </Button>
            <Text size="xsmall" className="text-ui-fg-muted text-center">
              Already clicked the link? Just sign in again.
            </Text>
          </div>
        ) : (
        <div className="flex w-full flex-col gap-y-3">
          {getWidgets("login.before").map((Component, i) => {
            return <Component key={i} />
          })}
          <Form {...form}>
            <form
              onSubmit={handleSubmit}
              className="flex w-full flex-col gap-y-6"
            >
              <div className="flex flex-col gap-y-1">
                <Form.Field
                  control={form.control}
                  name="email"
                  render={({ field }) => {
                    return (
                      <Form.Item>
                        <Form.Control>
                          <Input
                            autoComplete="email"
                            {...field}
                            className="bg-ui-bg-field-component"
                            placeholder={t("fields.email")}
                          />
                        </Form.Control>
                      </Form.Item>
                    )
                  }}
                />
                <Form.Field
                  control={form.control}
                  name="password"
                  render={({ field }) => {
                    return (
                      <Form.Item>
                        <Form.Label>{}</Form.Label>
                        <Form.Control>
                          <Input
                            type="password"
                            autoComplete="current-password"
                            {...field}
                            className="bg-ui-bg-field-component"
                            placeholder={t("fields.password")}
                          />
                        </Form.Control>
                      </Form.Item>
                    )
                  }}
                />
              </div>
              {validationError && (
                <div className="text-center">
                  <Hint className="inline-flex" variant={"error"}>
                    {validationError}
                  </Hint>
                </div>
              )}
              {serverError && (
                <Alert
                  className="bg-ui-bg-base items-center p-2"
                  dismissible
                  variant="error"
                >
                  {serverError}
                </Alert>
              )}
              <Button className="w-full" type="submit" isLoading={isPending}>
                {t("actions.continueWithEmail")}
              </Button>
            </form>
          </Form>
          {getWidgets("login.after").map((Component, i) => {
            return <Component key={i} />
          })}
        </div>
        )}
        <div className="text-ui-fg-muted txt-small my-6 flex w-full flex-col items-center gap-y-3">
          <Trans
            i18nKey="login.forgotPassword"
            components={[
              <Link
                key="reset-password-link"
                to="/reset-password"
                className="text-ui-fg-interactive transition-fg hover:text-ui-fg-interactive-hover focus-visible:text-ui-fg-interactive-hover font-medium outline-none"
              />,
            ]}
          />

          <div className="flex w-full flex-col items-center">
            <div className="h-px w-full border-b border-dotted" />
          </div>

          <Link
            key="register-link"
            to="/register"
            className="text-ui-fg-interactive transition-fg hover:text-ui-fg-interactive-hover focus-visible:text-ui-fg-interactive-hover font-medium outline-none"
          >
            Sign up
          </Link>

          <div className="flex w-full flex-col items-center gap-y-1">
            <div className="h-px w-full border-b border-dotted" />
            <Select
              value={i18n.language}
              onValueChange={(value) => i18n.changeLanguage(value)}
            >
              <Select.Trigger className="w-full">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {languages.map((lang) => (
                  <Select.Item key={lang.code} value={lang.code}>
                    {lang.display_name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}
