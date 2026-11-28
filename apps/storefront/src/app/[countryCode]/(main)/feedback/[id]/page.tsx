import { Metadata } from "next"

import { retrieveFeedback } from "@lib/data/feedback"
import FeedbackTemplate, { FeedbackNotFound } from "@modules/feedback/templates"

type Props = {
  // A promise on this Next version, as on the brief page.
  params: Promise<{ countryCode: string; id: string }>
}

/** The id in the link is the credential: never indexed. */
export const metadata: Metadata = {
  title: "How was your order?",
  description: "Tell us how your order arrived.",
  robots: { index: false, follow: false },
}

/** Per request: the answer changes the page. */
export const dynamic = "force-dynamic"

/**
 * Post-delivery feedback page. The delivery email links to
 * `<shop>/feedback/<id>`; the middleware adds the country prefix.
 */
export default async function FeedbackPage({ params }: Props) {
  const { id } = await params
  const view = await retrieveFeedback(id)
  if (!view) return <FeedbackNotFound />
  return <FeedbackTemplate view={view} feedbackId={id} />
}
