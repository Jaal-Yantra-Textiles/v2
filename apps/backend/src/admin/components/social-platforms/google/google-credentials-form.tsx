import { useTranslation } from "react-i18next"
import { z } from "@medusajs/framework/zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Badge, Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { Form } from "../../common/form"
import { KeyboundForm } from "../../utilitites/key-bound-form"
import { RouteDrawer } from "../../modal/route-drawer/route-drawer"
import { useRouteModal } from "../../modal/use-route-modal"
import {
  type AdminSocialPlatform,
  useUpdateSocialPlatform,
} from "../../../hooks/api/social-platforms"

const credentialsSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  developer_token: z.string().optional(),
})

type CredentialsFormData = z.infer<typeof credentialsSchema>

export const GoogleCredentialsForm = ({
  platform,
}: {
  platform: AdminSocialPlatform
}) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  const { mutateAsync, isPending } = useUpdateSocialPlatform(platform.id)

  const hasClientSecret = !!apiConfig.client_secret_encrypted
  const hasDeveloperToken = !!apiConfig.developer_token_encrypted

  const form = useForm<CredentialsFormData>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      client_id: apiConfig.client_id || "",
      client_secret: "",
      developer_token: "",
    },
  })

  const handleSubmit = form.handleSubmit(async (data) => {
    const apiConfigPatch: Record<string, any> = {}
    const clientId = (data.client_id || "").trim()
    if (clientId !== (apiConfig.client_id || "")) {
      apiConfigPatch.client_id = clientId || null
    }
    if (data.client_secret && data.client_secret.length > 0) {
      apiConfigPatch.client_secret = data.client_secret
      // Force re-encryption: the credential-encryption subscriber only runs
      // when the *_encrypted blob is missing, so null it out on rotation.
      apiConfigPatch.client_secret_encrypted = null
    }
    if (data.developer_token && data.developer_token.length > 0) {
      apiConfigPatch.developer_token = data.developer_token
      apiConfigPatch.developer_token_encrypted = null
    }
    if (Object.keys(apiConfigPatch).length === 0) {
      handleSuccess()
      return
    }
    await mutateAsync(
      { api_config: apiConfigPatch } as any,
      {
        onSuccess: () => {
          toast.success("Google credentials saved")
          handleSuccess()
        },
        onError: (error) => toast.error(error.message),
      }
    )
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto px-6 py-4">
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Per-row Google Cloud OAuth client. The redirect URI is shared via
              the <code>GOOGLE_REDIRECT_URI</code> env var.
            </Text>
          </div>

          <Form.Field
            control={form.control}
            name="client_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Client ID</Form.Label>
                <Form.Control>
                  <Input
                    {...field}
                    placeholder="1234567890-abc.apps.googleusercontent.com"
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="client_secret"
            render={({ field }) => (
              <Form.Item>
                <div className="flex items-center justify-between">
                  <Form.Label optional>Client secret</Form.Label>
                  {hasClientSecret && (
                    <Badge size="2xsmall" color="green">
                      Saved
                    </Badge>
                  )}
                </div>
                <Form.Control>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      hasClientSecret
                        ? "•••••••••• (leave blank to keep)"
                        : "GOCSPX-…"
                    }
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={form.control}
            name="developer_token"
            render={({ field }) => (
              <Form.Item>
                <div className="flex items-center justify-between">
                  <Form.Label optional>Developer token (Google Ads)</Form.Label>
                  {hasDeveloperToken && (
                    <Badge size="2xsmall" color="green">
                      Saved
                    </Badge>
                  )}
                </div>
                <Form.Control>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      hasDeveloperToken
                        ? "•••••••••• (leave blank to keep)"
                        : "Required for Ads API"
                    }
                  />
                </Form.Control>
                <Form.Hint>
                  Find this in your Google Ads Manager account under API Center.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
            >
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
