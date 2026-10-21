import { Metadata } from "next"
import { notFound } from "next/navigation"

import { getPartnerProfile } from "@lib/data/partner-profile"
import PartnerProfile from "@modules/partners/templates/partner-profile"

// Next may hand the segment over still percent-encoded ("HR%20HANDLOOM");
// a handle that is already decoded and holds a bare "%" must not throw.
const handleOf = (raw: string) => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { handle } = await props.params
  const partner = await getPartnerProfile(handleOf(handle))
  if (!partner) notFound()
  return {
    title: partner.name,
    description:
      partner.about?.slice(0, 160) ?? `The people who make our pieces: ${partner.name}.`,
    openGraph: partner.logo ? { images: [partner.logo] } : undefined,
  }
}

export default async function PartnerPage(props: Props) {
  const { handle } = await props.params
  const partner = await getPartnerProfile(handleOf(handle))
  if (!partner) notFound()
  return <PartnerProfile partner={partner} />
}
