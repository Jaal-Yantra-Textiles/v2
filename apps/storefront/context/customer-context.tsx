import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { sdk } from "@/lib/medusa"
import type { HttpTypes } from "@medusajs/types"

type CustomerContextType = {
  customer: HttpTypes.StoreCustomer | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshCustomer: () => Promise<void>
}

const CustomerContext = createContext<CustomerContextType | null>(null)

export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<HttpTypes.StoreCustomer | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshCustomer = useCallback(async () => {
    try {
      const { customer: fetchedCustomer } = await sdk.store.customer.retrieve()
      setCustomer(fetchedCustomer)
    } catch {
      setCustomer(null)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setIsLoading(true)
      await refreshCustomer()
      setIsLoading(false)
    }

    init()
  }, [refreshCustomer])

  const login = useCallback(async (email: string, password: string) => {
    const result = await sdk.auth.login("customer", "emailpass", {
      email,
      password,
    })

    if (typeof result !== "string") {
      throw new Error("Authentication requires additional steps")
    }

    await sdk.client.setToken(result)
    await refreshCustomer()
  }, [refreshCustomer])

  const logout = useCallback(async () => {
    await sdk.auth.logout()
    setCustomer(null)
  }, [])

  return (
    <CustomerContext.Provider
      value={{
        customer,
        isLoading,
        login,
        logout,
        refreshCustomer,
      }}
    >
      {children}
    </CustomerContext.Provider>
  )
}

export function useCustomer() {
  const context = useContext(CustomerContext)
  if (!context) {
    throw new Error("useCustomer must be used within a CustomerProvider")
  }

  return context
}
