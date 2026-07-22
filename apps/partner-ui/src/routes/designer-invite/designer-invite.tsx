import { zodResolver } from "@hookform/resolvers/zod"
import "@excalidraw/excalidraw/index.css"
import { Excalidraw } from "@excalidraw/excalidraw"
import { Alert, Badge, Button, Heading, Hint, Input, Text, toast } from "@medusajs/ui"
import { z } from "@medusajs/framework/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useParams } from "react-router-dom"

import { Form } from "../../components/common/form"
import AvatarBox from "../../components/common/logo-box/avatar-box"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { isFetchError } from "../../lib/is-fetch-error"

// Must match the SDK's jwtTokenStorageKey (lib/client/client.ts) so the bearer
// we store here authenticates every subsequent request. Same pattern as the
// wa-auth exchange in protected-route.tsx.
const JWT_TOKEN_STORAGE_KEY =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof __JWT_TOKEN_STORAGE_KEY__ !== "undefined" && __JWT_TOKEN_STORAGE_KEY__) ||
  "partner_ui_auth_token"

type InviteInfo = {
  status: string
  usable: boolean
  email_locked: boolean
  expires_at: string | null
  inviter_name: string | null
}

type InviteDesign = {
  id: string
  name?: string | null
  description?: string | null
  design_type?: string | null
  moodboard?: unknown
}

type InvitePreview = {
  invite: InviteInfo
  design: InviteDesign | null
}

type AcceptResponse = {
  token: string
  partner_id: string
  design_id: string
  redirect: string
}

const AcceptSchema = z
  .object({
    name: z.string().min(1, "Your name is required"),
    email: z.string().email(),
    password: z.string().min(8, "Use at least 8 characters"),
    repeat_password: z.string().min(1),
  })
  .superRefine(({ password, repeat_password }, ctx) => {
    if (password !== repeat_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["repeat_password"],
      })
    }
  })

/** Loose normalize so we can render the admin-authored scene read-only. */
const toScene = (raw: unknown) => {
  let parsed: any = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.elements)) {
    return null
  }
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: parsed.elements,
    appState: { ...(parsed.appState || {}), collaborators: new Map() },
    files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
  }
}

export const DesignerInvite = () => {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const { data, isPending, isError } = useQuery<InvitePreview>({
    queryKey: ["designer-invite", token],
    queryFn: async () =>
      sdk.client.fetch<InvitePreview>(`/partners/designer-invites/${token}`, {
        method: "GET",
      }),
    enabled: !!token,
    retry: false,
  })

  const scene = useMemo(() => toScene(data?.design?.moodboard), [data])

  const acceptMutation = useMutation<AcceptResponse, unknown, z.infer<typeof AcceptSchema>>({
    mutationFn: async (values) =>
      sdk.client.fetch<AcceptResponse>(`/partners/designer-invites/${token}/accept`, {
        method: "POST",
        body: {
          name: values.name,
          email: values.email,
          password: values.password,
        },
      }),
  })

  const form = useForm<z.infer<typeof AcceptSchema>>({
    resolver: zodResolver(AcceptSchema),
    defaultValues: { name: "", email: "", password: "", repeat_password: "" },
  })

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      const res = await acceptMutation.mutateAsync(values)
      // Store the returned partner bearer, then hard-navigate into the app so
      // the SDK picks it up from localStorage on the very next request.
      window.localStorage.setItem(JWT_TOKEN_STORAGE_KEY, res.token)
      await queryClient.invalidateQueries({ queryKey: ["users", "me"] })
      toast.success("Welcome! Taking you to the moodboard…")
      navigate(res.redirect || `/designs/${res.design_id}/moodboard`, { replace: true })
    } catch (error) {
      if (isFetchError(error)) {
        form.setError("root", {
          type: "manual",
          message:
            error.status === 400 || error.status === 401
              ? "This invite can't be accepted with those details. Check the email it was sent to."
              : error.message || "Something went wrong. Please try again.",
        })
        return
      }
      form.setError("root", {
        type: "manual",
        message: "Something went wrong. Please try again.",
      })
    }
  })

  const invite = data?.invite
  const design = data?.design
  const notUsable = !isPending && (isError || !invite || !invite.usable)

  return (
    <div className="bg-ui-bg-subtle relative flex min-h-dvh w-dvw items-center justify-center p-4">
      <div className="flex w-full max-w-5xl flex-col gap-y-6 lg:flex-row lg:gap-x-8">
        {/* Left — the brief the admin authored + a read-only moodboard preview */}
        <div className="bg-ui-bg-base shadow-elevation-card-rest flex w-full flex-col rounded-lg border p-6 lg:w-3/5">
          {isPending ? (
            <Text size="small" className="text-ui-fg-subtle">
              Loading the brief…
            </Text>
          ) : notUsable ? (
            <div className="flex flex-col gap-y-2">
              <Heading level="h2">Invite unavailable</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                This designer invite is expired, revoked, or has already been used.
              </Text>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-col gap-y-1">
                <div className="flex items-center gap-x-2">
                  <Heading level="h2">{design?.name || "Design brief"}</Heading>
                  {design?.design_type ? (
                    <Badge size="2xsmall">{design.design_type}</Badge>
                  ) : null}
                </div>
                {invite?.inviter_name ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    Invited by {invite.inviter_name}
                  </Text>
                ) : null}
              </div>

              {design?.description ? (
                <Text size="small" className="text-ui-fg-base mb-4 whitespace-pre-wrap">
                  {design.description}
                </Text>
              ) : null}

              <Text size="small" weight="plus" className="text-ui-fg-subtle mb-2">
                Moodboard preview
              </Text>
              {scene ? (
                <div className="relative h-[420px] w-full overflow-hidden rounded-md border">
                  <Excalidraw
                    initialData={scene as any}
                    viewModeEnabled={true}
                    excalidrawAPI={(api) => {
                      setTimeout(() => {
                        try {
                          api.scrollToContent(api.getSceneElements(), { fitToContent: true })
                        } catch {}
                      }, 60)
                    }}
                    UIOptions={{
                      canvasActions: {
                        changeViewBackgroundColor: false,
                        saveToActiveFile: false,
                        saveAsImage: false,
                        export: false,
                        loadScene: false,
                        clearCanvas: false,
                        toggleTheme: false,
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="border-ui-border-base text-ui-fg-muted flex h-[160px] items-center justify-center rounded-md border border-dashed">
                  <Text size="small">
                    No moodboard yet — you'll build it after accepting.
                  </Text>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right — accept form */}
        <div className="bg-ui-bg-base shadow-elevation-card-rest flex w-full flex-col items-center rounded-lg border p-6 lg:w-2/5">
          <AvatarBox />
          <div className="mb-4 flex flex-col items-center gap-y-1">
            <Heading>Join as the designer</Heading>
            <Text size="small" className="text-ui-fg-subtle text-center">
              Create your account to start authoring this moodboard.
            </Text>
          </div>

          <Form {...form}>
            <form onSubmit={handleSubmit} className="flex w-full flex-col gap-y-4">
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Control>
                      <Input
                        autoComplete="name"
                        {...field}
                        placeholder="Full name"
                      />
                    </Form.Control>
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="email"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Control>
                      <Input
                        type="email"
                        autoComplete="email"
                        {...field}
                        placeholder={
                          invite?.email_locked
                            ? "Email this invite was sent to"
                            : "Email"
                        }
                      />
                    </Form.Control>
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
                        type="password"
                        autoComplete="new-password"
                        {...field}
                        placeholder="Password"
                      />
                    </Form.Control>
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="repeat_password"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Control>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        {...field}
                        placeholder="Repeat password"
                      />
                    </Form.Control>
                  </Form.Item>
                )}
              />

              {form.formState.errors.root?.message ? (
                <Alert variant="error" className="p-2">
                  {form.formState.errors.root.message}
                </Alert>
              ) : (
                Object.values(form.formState.errors)[0]?.message && (
                  <Hint variant="error">
                    {String(Object.values(form.formState.errors)[0]?.message)}
                  </Hint>
                )
              )}

              <Button
                type="submit"
                className="w-full"
                isLoading={acceptMutation.isPending}
                disabled={notUsable}
              >
                Accept invite
              </Button>
            </form>
          </Form>

          <div className="my-6 h-px w-full border-b border-dotted" />
          <Link
            to="/login"
            className="txt-small text-ui-fg-base hover:text-ui-fg-base-hover font-medium outline-none"
          >
            Already have an account? Log in
          </Link>
        </div>
      </div>
    </div>
  )
}
