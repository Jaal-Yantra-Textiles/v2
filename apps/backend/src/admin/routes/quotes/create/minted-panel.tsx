import { Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"

/**
 * The post-mint panel — and the ONLY place the buyer's link ever exists.
 *
 * 🔴 `token` is returned by the mint and never again: the row stores only its
 * sha256, so no later read can reconstruct a working link. Everything about
 * this screen is shaped by that — it replaces the form rather than sitting
 * beside it, and it does not offer a way onward that skips copying.
 *
 * Mirrors the partner-side panel deliberately. Two differently-worded warnings
 * about the same irreversible fact is how one of them ends up softer.
 */
export const MintedPanel = ({
  token,
  quote,
}: {
  token: string
  quote: any
}) => {
  const navigate = useNavigate()

  const domain = quote?.storefront_domain || quote?.custom_domain
  const country = String(quote?.destination_country_code || "").toLowerCase()

  // The storefront routes every page under /[countryCode]; a link without that
  // segment 404s. The country comes from the quote's own destination.
  const link = domain && country ? `https://${domain}/${country}/quotes/${token}` : null

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Could not copy — select and copy manually.")
    }
  }

  return (
    <div className="flex flex-col gap-y-6 px-6 py-6">
      <div>
        <Heading>Quote minted</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          This link is shown once. Only its hash is stored, so it cannot be
          recovered later — copy it before you leave this page.
        </Text>
      </div>

      {link ? (
        <div className="flex flex-col gap-y-2">
          <Text size="small" weight="plus">
            Buyer link
          </Text>
          <div className="flex gap-2">
            <Input readOnly value={link} />
            <Button variant="secondary" onClick={() => copy(link, "Link")}>
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-y-2">
          <Text size="small" className="text-ui-fg-subtle">
            No storefront domain is connected for this partner, so there is no
            buyer link to share. Copy the token and connect a domain first.
          </Text>
          <div className="flex gap-2">
            <Input readOnly value={token} />
            <Button variant="secondary" onClick={() => copy(token, "Token")}>
              Copy
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => navigate(`/quotes/${quote?.id}`)}
        >
          View quote
        </Button>
        <Button onClick={() => navigate("/quotes")}>I&apos;ve copied the link</Button>
      </div>
    </div>
  )
}
