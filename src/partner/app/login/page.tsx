"use client";
import { login } from "./actions";
import { useTransition } from "react";
import { Alert, Button, Heading, Hint, Input, Text } from '@medusajs/ui'
import AvatarBox from "../components/avatar-box";
import { Form } from "../components/form";
import * as z from "zod"
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";

const LoginSchema = z.object({
  email: z.string().email("A valid email is required."),
  password: z.string().min(1, "Password is required."),
})

export default function LoginPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  const handleSubmit = form.handleSubmit(async (data) => {
    startTransition(async () => {
      const result = await login(data);
      console.log(result)
      if (result.error) {
        form.setError("root.serverError", {
          message: result.error,
        });
        return;
      }

      if (result.success) {
        router.push("/dashboard");
      }
    });
  });

  const serverError = form.formState.errors?.root?.serverError?.message
  const validationError =
    form.formState.errors.email?.message ||
    form.formState.errors.password?.message

  return (
    <div className="m-4 flex w-full max-w-xs flex-col items-center text-ui-fg-base">
        <AvatarBox />
        <div className="mb-4 mt-4 flex flex-col items-center">
          <Heading>Welcome to JYT Partner Space</Heading>
          <Text size="small" className="text-ui-fg-subtle text-center">
            Sign in to access the account area
          </Text>
        </div>
        <Form {...form}>
          <form
            onSubmit={handleSubmit}
            className="flex w-full flex-col gap-y-4"
          >
            <div className="flex flex-col gap-y-2">
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
                          placeholder="Email"
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
                      <Form.Control>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          {...field}
                          className="bg-ui-bg-field-component"
                          placeholder="Password"
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
            <Button type="submit" className="w-full mt-4" isLoading={isPending}>
              Sign In
            </Button>
          </form>
          <Text className="text-ui-fg-subtle text-center mt-6">
            Don&apos;t have an account?
            <Link href="/register" className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover ml-1">
              Sign Up
            </Link>
          </Text>
        </Form>
        <div className="text-ui-fg-muted txt-small mt-4 text-center">
          <span>Forgot password? - </span>
          <Link
            href="/reset-password"
            className="text-ui-fg-interactive transition-fg hover:text-ui-fg-interactive-hover focus-visible:text-ui-fg-interactive-hover font-medium outline-none"
          >
            Reset
          </Link>
        </div>
      </div>
  );
}
