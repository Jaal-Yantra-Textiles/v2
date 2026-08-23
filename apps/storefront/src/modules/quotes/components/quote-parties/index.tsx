import { Text } from "@medusajs/ui"

import type { QuoteParties } from "@lib/data/quotes"

/**
 * Who is selling and who is buying (#1486).
 *
 * A procurement buyer forwards this page to finance, and finance asks two
 * questions: who is the legal entity, and under which registration. A quote
 * that cannot answer them gets sent back.
 *
 * 🔴 The buyer's number is labelled "as provided". Nothing has checked it
 * against VIES or the GST portal, and a label that reads as verified invites a
 * reverse-charge assumption nobody is entitled to make. `tax_id_verified` is
 * false by construction, so this is a rule the component cannot get wrong by
 * being edited — but the wording is the part a reader acts on.
 */

const SCHEME_LABELS: Record<string, string> = {
  gstin: "GSTIN",
  eu_vat: "VAT",
  uk_vat: "VAT",
  abn: "ABN",
  pan: "PAN",
}

const schemeLabel = (type: string | null | undefined) => {
  if (!type) return "Tax ID"
  return SCHEME_LABELS[type.toLowerCase()] ?? type.toUpperCase()
}

const Party = ({
  heading,
  name,
  subline,
  taxId,
  taxIdType,
  caveat,
}: {
  heading: string
  name: string | null
  subline?: string | null
  taxId: string | null
  taxIdType: string | null
  caveat?: string | null
}) => (
  <div className="flex flex-col gap-y-1">
    <Text className="txt-small-plus text-ui-fg-subtle uppercase tracking-wide">
      {heading}
    </Text>
    {/* An em dash, never a blank: a missing party reads as a broken page. */}
    <Text className="txt-medium-plus text-ui-fg-base">{name || "—"}</Text>
    {subline ? (
      <Text className="txt-small text-ui-fg-subtle">{subline}</Text>
    ) : null}
    {taxId ? (
      <Text className="txt-small text-ui-fg-subtle mt-1">
        <span className="text-ui-fg-muted">{schemeLabel(taxIdType)}</span>{" "}
        <span className="font-mono">{taxId}</span>
      </Text>
    ) : null}
    {taxId && caveat ? (
      <Text className="txt-small text-ui-fg-muted">{caveat}</Text>
    ) : null}
  </div>
)

const QuotePartiesBlock = ({
  parties,
  partnerNote,
}: {
  parties: QuoteParties
  partnerNote?: string | null
}) => {
  const { seller, buyer } = parties

  // Nothing worth a box. Rendering an empty two-column frame would look like
  // data that failed to load.
  if (!seller.legal_name && !buyer.company && !buyer.contact_name) {
    return null
  }

  return (
    <div className="mt-6 rounded-lg border border-ui-border-base p-5">
      <div className="grid grid-cols-1 gap-6 small:grid-cols-2">
        <Party
          heading="From"
          name={seller.legal_name}
          subline={
            seller.origin_country_code
              ? `Shipping from ${seller.origin_country_code}`
              : null
          }
          taxId={seller.tax_id}
          taxIdType={seller.tax_id_type}
        />
        <Party
          heading="Prepared for"
          name={buyer.company || buyer.contact_name}
          subline={buyer.company && buyer.contact_name ? buyer.contact_name : null}
          taxId={buyer.tax_id}
          taxIdType={buyer.tax_id_type}
          caveat={
            buyer.tax_id_verified ? null : "As provided by you — tell us if it is wrong."
          }
        />
      </div>

      {partnerNote ? (
        <Text className="txt-medium text-ui-fg-subtle mt-5 whitespace-pre-line border-t border-ui-border-base pt-4">
          {partnerNote}
        </Text>
      ) : null}
    </div>
  )
}

export default QuotePartiesBlock
