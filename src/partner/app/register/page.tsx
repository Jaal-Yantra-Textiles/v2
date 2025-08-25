"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Text } from "@medusajs/ui"
import { Form } from "@/app/components/form"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { registerPartner } from "./actions"
import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { Alert } from "@medusajs/ui"
import Link from "next/link"

const RegisterSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  handle: z.string().min(1, "Handle is required"),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})


export default function RegisterPage() {
  const [isPending, startTransition] = useTransition()
  const [isSuccess, setIsSuccess] = useState(false)
  const router = useRouter()

  const form = useForm<z.infer<typeof RegisterSchema>>({
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

  const handleSubmit = form.handleSubmit(async (data) => {
    startTransition(async () => {
      const result = await registerPartner(data)

      if (result.error) {
        form.setError("root.serverError", {
          message: result.error,
        })
        return
      }

      if (result.success) {
        setIsSuccess(true)
        setTimeout(() => {
          router.push("/login")
        }, 3000) // 3-second delay before redirect
      }
    })
  })

  return (
    <div className="flex flex-col items-center p-4">
      <div className="w-full max-w-xs">
        <Heading level="h1" className="text-ui-fg-base text-center text-2xl">
          Become a JYT Partner
        </Heading>
        <Text className="text-ui-fg-subtle text-center mt-2">
          Create your partner account to get started.
        </Text>

        <Form {...form}>
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-y-4">
          <Form.Field
            control={form.control}
            name="company_name"
            render={({ field }) => {
              return (
                <Form.Item>
                <Form.Label className="text-ui-fg-base">Company Name</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="Acme Inc." autoComplete="organization" />
                </Form.Control>
              </Form.Item>
              )
            }}
          />
          <Form.Field
            control={form.control}
            name="handle"
            render={({ field }) => {
              return (
              <Form.Item>
                <Form.Label className="text-ui-fg-base">Company Handle</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="acme-inc" autoComplete="off" />
                </Form.Control>
              </Form.Item>
              )
            }}
          />
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Field
              control={form.control}
              name="first_name"
              render={({ field }) => {
                return (
                <Form.Item>
                  <Form.Label className="text-ui-fg-base">First Name</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="John" autoComplete="given-name" />
                  </Form.Control>
                </Form.Item>
              )
            }}
            />
            <Form.Field
              control={form.control}
              name="last_name"
              render={({ field }) => {
                return(
                <Form.Item>
                  <Form.Label className="text-ui-fg-base">Last Name</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="Doe" autoComplete="family-name"   />
                  </Form.Control>
                </Form.Item>
                )
              }}
            />
          </div>
          <Form.Field
            control={form.control}
            name="email"
            render={({ field }) => {
              return(
              <Form.Item>
                <Form.Label className="text-ui-fg-base">Email</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="admin@acme.com" autoComplete="email" />
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
                <Form.Label className="text-ui-fg-base">Password</Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="********" autoComplete="new-password" />
                </Form.Control>
              </Form.Item>
            )
            }}
          />

          {form.formState.errors.root?.serverError && (
            <Text className="text-red-500 text-sm">
              {form.formState.errors.root.serverError.message}
            </Text>
          )}

          <Button type="submit" className="w-full mt-4" isLoading={isPending}>
            Create Account
          </Button>
          <Text className="text-ui-fg-subtle text-center mt-6">
            Already have an account?
            <Link href="/login" className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover ml-1">
              Log in
            </Link>
          </Text>

          {isSuccess && (
            <Alert variant="success" className="mt-4 text-ui-fg-base">
              Registration successful! Redirecting to login...
            </Alert>
          )}
        </form>
      </Form>
      </div>
    </div>
  )
}
