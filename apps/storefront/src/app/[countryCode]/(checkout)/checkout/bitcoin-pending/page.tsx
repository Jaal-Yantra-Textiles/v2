import { Metadata } from "next"
import BitcoinPendingPoller from "@modules/checkout/components/bitcoin-pending-poller"

export const metadata: Metadata = {
  title: "Waiting for your Bitcoin payment",
  robots: { index: false, follow: false },
}

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ cart_id?: string }>
}

export default async function BitcoinPendingPage(props: Props) {
  const { cart_id: cartId } = await props.searchParams

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-3xl font-semibold text-amber-600" aria-hidden>
          ₿
        </div>
        <h1 className="mb-3 text-2xl font-semibold text-ui-fg-base">Waiting for your Bitcoin payment</h1>
        <p className="mb-6 text-ui-fg-subtle">
          If you have paid, the Bitcoin network needs to confirm it, which usually takes 10 to 60 minutes.
          Your order is placed automatically once it does. You can keep this page open or close it; we will
          email your order confirmation either way. If you have not paid yet, go back to checkout to get the
          payment page again.
        </p>
        {cartId ? <BitcoinPendingPoller cartId={cartId} /> : null}
      </div>
    </div>
  )
}
