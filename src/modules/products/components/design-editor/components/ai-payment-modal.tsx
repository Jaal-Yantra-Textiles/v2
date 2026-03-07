"use client"

import React, { useState, useEffect } from "react"
import { XMark } from "@medusajs/icons"
import { loadStripe } from "@stripe/stripe-js"
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js"
import { createAiAccessFeeIntent, confirmAiAccessFee } from "@lib/data/ai-access-fee"

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_KEY ?? ""
)

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontFamily: "Inter, sans-serif",
      color: "#424270",
      "::placeholder": { color: "rgb(107 114 128)" },
    },
  },
  classes: {
    base: "pt-3 pb-1 block w-full h-11 px-4 mt-0 bg-white border rounded-md appearance-none focus:outline-none border-gray-300",
  },
}

type PaymentFormProps = {
  clientSecret: string
  sessionId: string
  onSuccess: () => void
  onClose: () => void
}

function PaymentForm({ clientSecret, sessionId, onSuccess, onClose }: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return

    setIsProcessing(true)
    setError(null)

    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      setError("Card element not found")
      setIsProcessing(false)
      return
    }

    const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
      clientSecret,
      { payment_method: { card: cardElement } }
    )

    if (stripeError) {
      // requires_capture means Stripe authorized but Medusa will capture — treat as success
      if (
        stripeError.payment_intent?.status === "requires_capture" ||
        stripeError.payment_intent?.status === "succeeded"
      ) {
        // fall through to confirm below
      } else {
        setError(stripeError.message ?? "Payment failed")
        setIsProcessing(false)
        return
      }
    }

    const piStatus = paymentIntent?.status ?? stripeError?.payment_intent?.status
    if (piStatus !== "succeeded" && piStatus !== "requires_capture") {
      setError("Payment not completed. Please try again.")
      setIsProcessing(false)
      return
    }

    // Payment succeeded client-side — confirm via Medusa payment module
    const confirmResult = await confirmAiAccessFee(sessionId)
    if (confirmResult.success) {
      onSuccess()
    } else {
      setError(confirmResult.error ?? "Failed to activate AI features. Contact support.")
    }

    setIsProcessing(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-2">
          Card details
        </label>
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-200">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={isProcessing}
          className="flex-1 rounded-full border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isProcessing || !stripe}
          className="flex-1 rounded-full bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:from-violet-700 hover:to-blue-700 transition-all disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing…
            </>
          ) : (
            "Pay €2.00"
          )}
        </button>
      </div>
    </form>
  )
}

type AiPaymentModalProps = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function AiPaymentModal({ isOpen, onClose, onSuccess }: AiPaymentModalProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setClientSecret(null)
      setSessionId(null)
      setError(null)
      return
    }

    setIsLoading(true)
    createAiAccessFeeIntent()
      .then((result) => {
        if (result.alreadyPaid) {
          onSuccess()
          setIsLoading(false)
          return
        }
        if (result.error) {
          setError(result.error)
        } else {
          setClientSecret(result.clientSecret)
          setSessionId(result.sessionId)
        }
        setIsLoading(false)
      })
      .catch((err: any) => {
        setError(err?.message || "Failed to initialize payment. Please try again.")
        setIsLoading(false)
      })
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/30 bg-white/95 p-6 shadow-2xl backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100">
              <span className="text-violet-600 text-base">✦</span>
            </div>
            <span className="text-base font-semibold text-gray-900">Verify your account</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <XMark />
          </button>
        </div>

        {/* Description */}
        <div className="mb-5 rounded-2xl bg-violet-50 border border-violet-100 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white">
              €2
            </div>
            <p className="text-xs text-violet-800 leading-relaxed">
              One-time non-refundable access fee. Unlocks <strong>Virtual Try-On</strong> and <strong>AI image generation</strong> permanently.
            </p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <svg className="h-6 w-6 animate-spin text-violet-500" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {error && !isLoading && (
          <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-200">
            {error}
          </p>
        )}

        {clientSecret && sessionId && !isLoading && (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <PaymentForm
              clientSecret={clientSecret}
              sessionId={sessionId}
              onSuccess={onSuccess}
              onClose={onClose}
            />
          </Elements>
        )}
      </div>
    </div>
  )
}
