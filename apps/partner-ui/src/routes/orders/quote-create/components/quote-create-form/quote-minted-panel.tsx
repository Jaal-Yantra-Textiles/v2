import { CheckCircleSolid, ExclamationCircle } from "@medusajs/icons"
import { Alert, Button, Heading, IconButton, Input, Text, toast } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { RouteFocusModal, useRouteModal } from "../../../../../components/modals"
import { MintPartnerQuoteResponse } from "../../../../../hooks/api/partner-quotes"
import { usePartnerSettings } from "../../../../../hooks/api/partner-settings"

type QuoteMintedPanelProps = {
  result: MintPartnerQuoteResponse
}

/**
 * The post-mint panel — and the only place the buyer's link ever exists.
 *
 * 🔴 `token` is returned by the mint and never again: the row stores only its
 * sha256, so no later read can reconstruct a working link. That is why this is
 * a panel rather than a toast-and-navigate — closing without copying means the
 * quote has to be re-minted.
 */
export const QuoteMintedPanel = ({ result }: QuoteMintedPanelProps) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const { partner } = usePartnerSettings()

  const domain =
    (partner as any)?.custom_domain || (partner as any)?.storefront_domain

  const link = domain
    ? `https://${domain}/quotes/${result.token}`
    : null

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t("quotes.minted.copied", `${label} copied`))
    } catch {
      toast.error(
        t("quotes.minted.copyFailed", "Could not copy — select and copy manually.")
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-2">
          <CheckCircleSolid className="text-ui-fg-interactive" />
          <Heading level="h2">
            {t("quotes.minted.header", "Quote minted")}
          </Heading>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex-1 overflow-y-auto p-16">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-6">
          <Alert variant="warning">
            {t(
              "quotes.minted.onceWarning",
              "This link is shown once. Only its hash is stored, so it cannot be recovered later — copy it before you close this."
            )}
          </Alert>

          <div className="flex flex-col gap-y-2">
            <Text size="small" weight="plus">
              {t("quotes.minted.buyerLink", "Buyer link")}
            </Text>
            {link ? (
              <div className="flex items-center gap-x-2">
                <Input readOnly value={link} />
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => copy(link, "Link")}
                >
                  {t("actions.copy", "Copy")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-y-2">
                <Alert variant="info">
                  {t(
                    "quotes.minted.noDomain",
                    "No storefront domain is connected yet, so there is no buyer link to share. Copy the token and connect a domain in Settings."
                  )}
                </Alert>
                <div className="flex items-center gap-x-2">
                  <Input readOnly value={result.token} />
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => copy(result.token, "Token")}
                  >
                    {t("actions.copy", "Copy")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Alert variant="info">
            {t(
              "quotes.minted.pageNotLive",
              "The buyer-facing quote page is not deployed yet (#1389 step 4). The quote and its prices are real — the buyer's price list is already active — but this link will not render until that page ships."
            )}
          </Alert>

          <div className="text-ui-fg-subtle flex items-start gap-x-2">
            <ExclamationCircle className="mt-0.5 shrink-0" />
            <Text size="small">
              {t(
                "quotes.minted.pricingNote",
                "These prices are live for this buyer only, until the quote expires. Their cart will charge exactly what the quote says."
              )}
            </Text>
          </div>
        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <Button
            variant="primary"
            size="small"
            onClick={() => handleSuccess("/orders/quotes")}
          >
            {t("quotes.minted.done", "I've copied the link")}
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </div>
  )
}
