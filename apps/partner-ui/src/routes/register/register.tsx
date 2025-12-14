import { zodResolver } from "@hookform/resolvers/zod"
import { Alert, Button, Heading, Hint, Input, Text } from "@medusajs/ui"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import * as z from "zod"

import { Form } from "../../components/common/form"
import AvatarBox from "../../components/common/logo-box/avatar-box"
import { useRegisterPartner } from "../../hooks/api"
import { isFetchError } from "../../lib/is-fetch-error"

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
      onSuccess: () => {
        setSuccess(true)

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
