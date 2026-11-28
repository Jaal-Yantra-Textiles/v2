import { Metadata } from "next"
import TrackOrderForm from "@modules/order/components/track-order-form"

export const metadata: Metadata = {
  title: "Track your order",
  description: "See the status of your order with your order number and email.",
}

type Props = { params: Promise<{ countryCode: string }> }

export default async function TrackOrderPage(props: Props) {
  const { countryCode } = await props.params
  return (
    <div className="content-container flex min-h-[60vh] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-semibold text-ui-fg-base">Track your order</h1>
        <p className="mb-8 text-ui-fg-subtle">
          Enter the order number from your confirmation email and the email you ordered with. You will see
          where your order is, its payment, and tracking once it ships. No account needed.
        </p>
        <TrackOrderForm countryCode={countryCode} />
      </div>
    </div>
  )
}
