import { Metadata } from "next"

import AiSearchChat from "@modules/home/components/ai-search-chat"

export const metadata: Metadata = {
  title: "Cici concierge",
  description:
    "Chat with the Cici Label concierge — find products, fabrics, custom design, and sizing in your own words.",
}

type Props = {
  searchParams: Promise<{ q?: string }>
}

export default async function ChatPage({ searchParams }: Props) {
  const { q } = await searchParams
  const initialQuery = typeof q === "string" && q.trim() ? q.trim() : undefined

  return <AiSearchChat initialQuery={initialQuery} />
}
