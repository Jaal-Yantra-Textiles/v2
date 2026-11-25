import { Container, Heading, Text } from "@medusajs/ui"
import { UseFormReturn, useWatch } from "react-hook-form"

import { BriefFormValues } from "./schema"

const Row = ({ label, value }: { label: string; value?: string | null }) => (
  <div className="grid grid-cols-2 items-center px-6 py-4">
    <Text size="small" weight="plus" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="small">{value || "-"}</Text>
  </div>
)

/** Step 3: what will be created. Creating sends nothing. */
export const BriefReviewStep = ({ form }: { form: UseFormReturn<BriefFormValues> }) => {
  const v = useWatch({ control: form.control }) as BriefFormValues

  return (
    <div className="flex flex-col items-center p-16">
      <div className="flex w-full max-w-[720px] flex-col gap-y-8">
        <div>
          <Heading>Review</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Creating the brief sends nothing. Open it afterwards to get the buyer's link.
          </Text>
        </div>
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">{v.title || "Untitled brief"}</Heading>
          </div>
          <Row label="Lead partner" value={v.partner_name} />
          <Row label="Buyer" value={[v.recipient_name, v.recipient_company, v.buyer_email].filter(Boolean).join(" · ")} />
          <Row label="Ships to" value={v.destination_country_code?.toUpperCase()} />
          <Row label="Samples" value={v.sample_quantity ? `${v.sample_quantity} pcs${v.sample_days ? `, photos in ~${v.sample_days} days` : ""}` : null} />
        </Container>
        {(v.options ?? []).map((o, oi) => (
          <Container key={o.key} className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">{o.title || `Style ${oi + 1}`}</Heading>
            </div>
            {(o.steps ?? []).map((s, si) => (
              <Row
                key={s.key}
                label={s.label || s.technique || `Step ${si + 1}`}
                value={
                  s.choices?.length
                    ? s.choices.map((c) => `${c.partner_name}${c.rate_id ? "" : " (we'll confirm)"}`).join(", ")
                    : "Exploring partners"
                }
              />
            ))}
          </Container>
        ))}
      </div>
    </div>
  )
}
