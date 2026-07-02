import { zodResolver } from "@hookform/resolvers/zod"
import { Alert, Button, Heading, Hint, Input, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import { z as z } from "@medusajs/framework/zod"

import { Form } from "../../components/common/form"
import AvatarBox from "../../components/common/logo-box/avatar-box"
import { useRegisterPartner } from "../../hooks/api"
import { isFetchError } from "../../lib/is-fetch-error"
import { resendPartnerVerification } from "../../lib/partner-verification"

const RegisterSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  handle: z.string().min(1, "Handle is required"),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

type RegisterValues = z.infer<typeof RegisterSchema>

export const Register = () => {
  const [success, setSuccess] = useState(false)
  const [pendingVerification, setPendingVerification] = useState<
    { email: string; password: string } | null
  >(null)
  const [resendPending, setResendPending] = useState(false)
  const navigate = useNavigate()

  const form = useForm<RegisterValues>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: {
      company_name: "",
      handle: "",
      first_name: "",
      last_name: "",
      email: "",
      password: "",
    },
  })

  const { mutateAsync, isPending } = useRegisterPartner()

  const handleSubmit = form.handleSubmit(async (values) => {
    await mutateAsync(values, {
      onSuccess: (data) => {
        setSuccess(true)

        if (data.verificationRequired) {
          // Hold email+password (this session only) so "Resend" can re-login.
          setPendingVerification({
            email: values.email,
            password: values.password,
          })
          return
        }

        setTimeout(() => {
          navigate("/login", { replace: true })
        }, 3000)
      },
      onError: (error: unknown) => {
        if (isFetchError(error)) {
          form.setError("root.serverError", {
            type: "manual",
            message: error.message,
          })
          return
        }

        form.setError("root.serverError", {
          type: "manual",
          message: error instanceof Error ? error.message : "Unknown error",
        })
      },
    })
  })

  const handleResend = async () => {
    if (!pendingVerification) {
      return
    }
    setResendPending(true)
    try {
      const stillPending = await resendPartnerVerification(
        pendingVerification.email,
        pendingVerification.password
      )
      if (stillPending) {
        toast.success("Verification email sent", {
          description: `We re-sent the link to ${pendingVerification.email}.`,
        })
      } else {
        toast.info("Your email is already verified — you can sign in.")
      }
    } catch (e) {
      toast.error("Couldn't resend the email", {
        description: e instanceof Error ? e.message : "Please try again shortly.",
      })
    } finally {
      setResendPending(false)
    }
  }

  // Post-registration: email verification pending — show the "check your inbox"
  // panel instead of the form.
  if (pendingVerification) {
    return (
      <div className="bg-ui-bg-subtle relative flex min-h-dvh w-dvw items-center justify-center p-4">
        <div className="flex w-full max-w-[360px] flex-col items-center">
          <AvatarBox checked />
          <div className="w-full text-center">
            <Heading>Check your email</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-2 block">
              We sent a verification link to{" "}
              <span className="text-ui-fg-base font-medium">
                {pendingVerification.email}
              </span>
              . Click it to activate your partner account, then sign in.
            </Text>

            <Alert className="bg-ui-bg-base mt-6 text-left" variant="info">
              Didn't get it? Check spam, or resend the link below. The link
              expires after a short while.
            </Alert>

            <div className="mt-6 flex flex-col gap-y-3">
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleResend}
                isLoading={resendPending}
              >
                Resend verification email
              </Button>
              <Button
                variant="primary"
                className="w-full"
                onClick={() => navigate("/login", { replace: true })}
              >
                Go to sign in
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const serverError = form.formState.errors?.root?.serverError?.message
  const validationError =
    form.formState.errors.company_name?.message ||
    form.formState.errors.handle?.message ||
    form.formState.errors.first_name?.message ||
    form.formState.errors.last_name?.message ||
    form.formState.errors.email?.message ||
    form.formState.errors.password?.message

  return (
    <div className="bg-ui-bg-subtle relative flex min-h-dvh w-dvw items-center justify-center p-4">
      <div className="flex w-full max-w-[360px] flex-col items-center">
        <AvatarBox checked={success} />

        <div className="w-full">
          <div className="mb-4 flex flex-col items-center">
            <Heading>Become a partner</Heading>
            <Text size="small" className="text-ui-fg-subtle text-center">
              Create your partner account to get started.
            </Text>
          </div>

          <Form {...form}>
            <form onSubmit={handleSubmit} className="flex w-full flex-col gap-y-6">
              <div className="flex flex-col gap-y-2">
                <Form.Field
                  control={form.control}
                  name="company_name"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Control>
                        <Input
                          {...field}
                          autoComplete="organization"
                          className="bg-ui-bg-field-component"
                          placeholder="Company Name"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="handle"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Control>
                        <Input
                          {...field}
                          autoComplete="off"
                          className="bg-ui-bg-field-component"
                          placeholder="Company Handle"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <div className="grid grid-cols-2 gap-x-4">
                  <Form.Field
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Control>
                          <Input
                            {...field}
                            autoComplete="given-name"
                            className="bg-ui-bg-field-component"
                            placeholder="First Name"
                          />
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
                        <Form.Control>
                          <Input
                            {...field}
                            autoComplete="family-name"
                            className="bg-ui-bg-field-component"
                            placeholder="Last Name"
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                </div>

                <Form.Field
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Control>
                        <Input
                          {...field}
                          autoComplete="email"
                          className="bg-ui-bg-field-component"
                          placeholder="Email"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Control>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="new-password"
                          className="bg-ui-bg-field-component"
                          placeholder="Password"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {validationError ? (
                  <div className="mt-6 text-center">
                    <Hint className="inline-flex" variant="error">
                      {validationError}
                    </Hint>
                  </div>
                ) : null}

                {serverError ? (
                  <Alert
                    className="bg-ui-bg-base items-center p-2"
                    dismissible
                    variant="error"
                  >
                    {serverError}
                  </Alert>
                ) : null}

                {success ? (
                  <Alert
                    className="bg-ui-bg-base items-center p-2"
                    dismissible
                    variant="success"
                  >
                    Registration successful! Redirecting to login...
                  </Alert>
                ) : null}
              </div>

              <Button className="w-full" type="submit" isLoading={isPending}>
                Create Account
              </Button>
            </form>
          </Form>

          <div className="flex w-full flex-col items-center">
            <div className="my-6 h-px w-full border-b border-dotted" />
            <Link
              key="login-link"
              to="/login"
              className="txt-small text-ui-fg-base transition-fg hover:text-ui-fg-base-hover focus-visible:text-ui-fg-base-hover font-medium outline-none"
            >
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
