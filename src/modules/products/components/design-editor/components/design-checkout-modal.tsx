"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Text } from "@medusajs/ui"
import {
  ShoppingCart,
  XMark,
  Spinner,
  CheckCircleSolid,
  ExclamationCircleSolid,
} from "@medusajs/icons"
import {
  getDesignEstimate,
  checkoutDesign,
  CostEstimate,
} from "@lib/data/designs"
import { addToCart } from "@lib/data/cart"

type DesignCheckoutModalProps = {
  isOpen: boolean
  onClose: () => void
  designId: string | null
  designName: string
  countryCode: string
  hasMaterial?: boolean
  hasPartner?: boolean
}

export function DesignCheckoutModal({
  isOpen,
  onClose,
  designId,
  designName,
  countryCode,
  hasMaterial = false,
  hasPartner = false,
}: DesignCheckoutModalProps) {
  const missingSetup = !hasMaterial || !hasPartner
  const router = useRouter()
  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [isLoadingEstimate, setIsLoadingEstimate] = useState(false)
  const [isAddingToCart, setIsAddingToCart] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Fetch estimate when modal opens — only if material and partner are set
  useEffect(() => {
    if (isOpen && designId && !estimate && !missingSetup) {
      setIsLoadingEstimate(true)
      setError(null)
      getDesignEstimate(designId)
        .then((data) => {
          setEstimate(data)
        })
        .catch((err) => {
          console.error("Failed to get estimate:", err)
          setError("Could not load price estimate")
        })
        .finally(() => {
          setIsLoadingEstimate(false)
        })
    }
  }, [isOpen, designId, estimate, missingSetup])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setEstimate(null)
      setError(null)
      setSuccess(false)
    }
  }, [isOpen])

  const handleAddToCart = async () => {
    if (!designId) return

    setIsAddingToCart(true)
    setError(null)

    try {
      // 1. Checkout design to create product/variant
      const result = await checkoutDesign(designId, { currency_code: "usd" })

      // 2. Add variant to cart
      await addToCart({
        variantId: result.variant_id,
        quantity: 1,
        countryCode,
      })

      // 3. Show success briefly then redirect
      setSuccess(true)
      setTimeout(() => {
        router.push(`/${countryCode}/cart`)
      }, 1000)
    } catch (err) {
      console.error("Failed to add to cart:", err)
      setError("Failed to add to cart. Please try again.")
      setIsAddingToCart(false)
    }
  }

  if (!isOpen) return null

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount / 100)
  }

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case "exact":
        return "text-green-600"
      case "estimated":
        return "text-amber-600"
      case "guesstimate":
        return "text-orange-600"
      default:
        return "text-gray-600"
    }
  }

  const getConfidenceLabel = (confidence: string) => {
    switch (confidence) {
      case "exact":
        return "Exact price"
      case "estimated":
        return "Estimated price"
      case "guesstimate":
        return "Approximate price"
      default:
        return confidence
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/30 bg-white/95 p-6 shadow-2xl backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
              <CheckCircleSolid className="text-green-600" />
            </div>
            <div>
              <Text weight="plus" className="text-lg text-gray-900">
                Design Saved!
              </Text>
              <Text size="small" className="text-gray-500">
                {designName}
              </Text>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <XMark />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Loading state */}
          {isLoadingEstimate && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">Loading price estimate...</span>
            </div>
          )}

          {/* Error state */}
          {error && !isLoadingEstimate && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-600">
                <ExclamationCircleSolid />
                <Text size="small" weight="plus">
                  {error}
                </Text>
              </div>
            </div>
          )}

          {/* Success state */}
          {success && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircleSolid />
                <Text size="small" weight="plus">
                  Added to cart! Redirecting...
                </Text>
              </div>
            </div>
          )}

          {/* Nudge: missing material or partner */}
          {missingSetup && !success && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <Text weight="plus" className="text-sm text-amber-800">
                Price breakdown not available yet
              </Text>
              <Text size="small" className="text-amber-700">
                To see a full price breakdown, go back and add:
              </Text>
              <ul className="space-y-1.5 text-sm text-amber-700">
                {!hasMaterial && (
                  <li className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-amber-400 flex items-center justify-center text-[10px] flex-shrink-0">○</span>
                    A material (fabric, thread, etc.)
                  </li>
                )}
                {!hasPartner && (
                  <li className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-amber-400 flex items-center justify-center text-[10px] flex-shrink-0">○</span>
                    A production partner
                  </li>
                )}
              </ul>
              <Text size="xsmall" className="text-amber-600">
                You can still save the design and add these details later.
              </Text>
            </div>
          )}

          {/* Price breakdown */}
          {estimate && !missingSetup && !isLoadingEstimate && !success && (
            <div className="rounded-2xl border border-gray-200 bg-gray-50/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 bg-white/50">
                <Text weight="plus" className="text-sm text-gray-700">
                  Price Breakdown
                </Text>
              </div>
              <div className="p-4 space-y-3">
                {/* Materials */}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Materials</span>
                  <span className="font-medium text-gray-900">
                    {formatPrice(estimate.costs.material_cost)}
                  </span>
                </div>

                {/* Production */}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    Production ({estimate.breakdown.production_percent}%)
                  </span>
                  <span className="font-medium text-gray-900">
                    {formatPrice(estimate.costs.production_cost)}
                  </span>
                </div>

                {/* Divider */}
                <div className="border-t border-gray-200 pt-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-semibold text-gray-900">Total</span>
                      <span
                        className={`ml-2 text-xs ${getConfidenceColor(
                          estimate.costs.confidence
                        )}`}
                      >
                        ({getConfidenceLabel(estimate.costs.confidence)})
                      </span>
                    </div>
                    <span className="text-lg font-bold text-gray-900">
                      {formatPrice(estimate.costs.total_estimated)}
                    </span>
                  </div>
                </div>

                {/* Material details if available */}
                {estimate.breakdown.materials.length > 0 && (
                  <div className="pt-2">
                    <Text size="xsmall" className="text-gray-500 mb-2">
                      Materials used:
                    </Text>
                    <div className="space-y-1">
                      {estimate.breakdown.materials.map((material, idx) => (
                        <div
                          key={idx}
                          className="flex justify-between text-xs text-gray-500"
                        >
                          <span>
                            {material.name} (x{material.quantity})
                          </span>
                          <span>{formatPrice(material.cost)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isAddingToCart || success}
            className="flex-1 rounded-full"
          >
            Save for Later
          </Button>
          <Button
            onClick={handleAddToCart}
            disabled={isAddingToCart || isLoadingEstimate || success || !!error || missingSetup}
            className="flex-1 rounded-full shadow-lg disabled:shadow-none"
          >
            {isAddingToCart ? (
              <>
                <Spinner className="animate-spin mr-2" />
                Adding...
              </>
            ) : (
              <>
                <ShoppingCart className="mr-2" />
                Add to Cart
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
