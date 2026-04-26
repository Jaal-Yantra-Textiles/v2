import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import { sdk } from "@/lib/medusa"
import { useRegion } from "./region-context"
import type { HttpTypes } from "@medusajs/types"

type CartContextType = {
  cart: HttpTypes.StoreCart | null
  isLoading: boolean
  addItem: (variantId: string, quantity: number) => Promise<void>
  updateItem: (lineItemId: string, quantity: number) => Promise<void>
  removeItem: (lineItemId: string) => Promise<void>
  refreshCart: () => Promise<void>
  clearCart: () => void
}

const CartContext = createContext<CartContextType | null>(null)

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<HttpTypes.StoreCart | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { region } = useRegion()

  const createCart = useCallback(async () => {
    if (!region) return null

    try {
      const { cart: newCart } = await sdk.store.cart.create({
        region_id: region.id,
      })
      return newCart
    } catch (error) {
      console.error("Failed to create cart:", error)
      return null
    }
  }, [region])

  const refreshCart = useCallback(async () => {
    if (!cart?.id) return

    try {
      const { cart: updatedCart } = await sdk.store.cart.retrieve(cart.id)
      setCart(updatedCart)
    } catch (error) {
      console.error("Failed to refresh cart:", error)
    }
  }, [cart?.id])

  useEffect(() => {
    const initCart = async () => {
      if (!region) return

      setIsLoading(true)
      const newCart = await createCart()
      setCart(newCart)
      setIsLoading(false)
    }

    initCart()
  }, [region, createCart])

  const addItem = useCallback(
    async (variantId: string, quantity: number) => {
      if (!cart?.id) {
        const newCart = await createCart()
        if (!newCart) return
        setCart(newCart)

        const { cart: updatedCart } = await sdk.store.cart.createLineItem(newCart.id, {
          variant_id: variantId,
          quantity,
        })
        setCart(updatedCart)
        return
      }

      try {
        const { cart: updatedCart } = await sdk.store.cart.createLineItem(cart.id, {
          variant_id: variantId,
          quantity,
        })
        setCart(updatedCart)
      } catch (error) {
        console.error("Failed to add item:", error)
      }
    },
    [cart?.id, createCart]
  )

  const updateItem = useCallback(
    async (lineItemId: string, quantity: number) => {
      if (!cart?.id) return

      try {
        const { cart: updatedCart } = await sdk.store.cart.updateLineItem(cart.id, lineItemId, {
          quantity,
        })
        setCart(updatedCart)
      } catch (error) {
        console.error("Failed to update item:", error)
      }
    },
    [cart?.id]
  )

  const removeItem = useCallback(
    async (lineItemId: string) => {
      if (!cart?.id) return

      try {
        await sdk.store.cart.deleteLineItem(cart.id, lineItemId)
        // Refresh cart after deletion
        const { cart: updatedCart } = await sdk.store.cart.retrieve(cart.id)
        setCart(updatedCart)
      } catch (error) {
        console.error("Failed to remove item:", error)
      }
    },
    [cart?.id]
  )

  const clearCart = useCallback(() => {
    setCart(null)
  }, [])

  return (
    <CartContext.Provider
      value={{
        cart,
        isLoading,
        addItem,
        updateItem,
        removeItem,
        refreshCart,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error("useCart must be used within a CartProvider")
  }
  return context
}
