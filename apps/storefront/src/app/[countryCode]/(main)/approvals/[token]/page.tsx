import { Heading, Text } from "@medusajs/ui"
import { Metadata } from "next"
import { notFound } from "next/navigation"

import { retrieveOrderApproval } from "@lib/data/approvals"
import ApprovalPanel from "@modules/approvals/components/approval-panel"

/**
 * #2463 — the customer approves or rejects their finished goods.
 *
 * 🔴 `params` is a PROMISE on Next 16 (see the quote page). The token IS the
 * credential: never indexed, never cached.
 */
type Props = {
  params: Promise<{ countryCode: string; token: string }>
}

export const metadata: Metadata = {
  title: "Approve your order",
  description: "Review the photos of your finished order.",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function ApprovalPage({ params }: Props) {
  const { token } = await params
  const approval = await retrieveOrderApproval(token)
  if (!approval) {
    notFound()
  }

  return (
    <div className="content-container py-12 max-w-3xl" data-testid="approval-page">
      <Heading level="h1" className="text-2xl-semi">
        {approval.order_display_id
          ? `Your order #${approval.order_display_id} is ready`
          : "Your order is ready"}
      </Heading>
      <Text className="txt-medium text-ui-fg-subtle mt-2">
        Hi {approval.customer_name}, here are photos of your finished pieces.
      </Text>

      {approval.note && (
        <div className="rounded-lg bg-ui-bg-subtle p-4 mt-6">
          <Text className="txt-medium">{approval.note}</Text>
        </div>
      )}

      <div className="grid grid-cols-1 small:grid-cols-2 gap-4 mt-6">
        {approval.photos.map((p) => (
          <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt={p.filename ?? "Photo of your order"}
              className="w-full rounded-lg object-cover"
            />
          </a>
        ))}
      </div>

      {approval.items.length > 0 && (
        <ul className="mt-6 flex flex-col gap-1">
          {approval.items.map((i, idx) => (
            <li key={idx}>
              <Text className="txt-medium">
                {i.quantity} × {i.title}
              </Text>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <ApprovalPanel token={token} initial={approval} />
      </div>
    </div>
  )
}
