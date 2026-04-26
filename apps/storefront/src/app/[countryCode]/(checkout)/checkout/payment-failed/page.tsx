import { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Payment Failed",
  robots: { index: false, follow: false },
}

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ error?: string; cart_id?: string }>
}

export default async function PaymentFailedPage(props: Props) {
  const params = await props.params
  const searchParams = await props.searchParams

  const error = searchParams.error
    ? decodeURIComponent(searchParams.error)
    : "Your payment could not be processed"
  const cartId = searchParams.cart_id
  const countryCode = params.countryCode

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Oops! Payment didn't go through
        </h1>

        {/* Error message */}
        <p className="text-gray-500 mb-2">
          {error}
        </p>
        <p className="text-sm text-gray-400 mb-8">
          Don't worry — your cart is safe and no money was charged.
        </p>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Link
            href={`/${countryCode}/checkout?step=payment`}
            className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          >
            Try again
          </Link>

          <Link
            href={`/${countryCode}/cart`}
            className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Back to cart
          </Link>
        </div>

        {/* Help text */}
        <p className="mt-8 text-xs text-gray-400">
          If this keeps happening, try a different payment method or contact us
          and we can send you a payment link to your email.
        </p>
      </div>
    </div>
  )
}
