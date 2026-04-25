import React, { useEffect, useState } from "react"
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useRouter } from "expo-router"
import { sdk } from "@/lib/medusa"
import type { HttpTypes } from "@medusajs/types"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { useCustomer } from "@/context/customer-context"
import { Loading } from "@/components/loading"
import { formatPrice } from "@/lib/format-price"

export default function OrdersScreen() {
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { customer, isLoading: isCustomerLoading } = useCustomer()

  const [orders, setOrders] = useState<HttpTypes.StoreOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const run = async () => {
      if (isCustomerLoading) return

      if (!customer) {
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      try {
        const { orders: fetchedOrders } = await sdk.store.order.list({
          limit: 20,
          offset: 0,
        })
        setOrders(fetchedOrders || [])
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Failed to load orders")
      } finally {
        setIsLoading(false)
      }
    }

    run()
  }, [customer, isCustomerLoading])

  if (isCustomerLoading || isLoading) {
    return <Loading message="Loading orders..." />
  }

  if (!customer) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}> 
        <Text style={[styles.title, { color: colors.text }]}>Login required</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Please login to view your orders.</Text>
        <TouchableOpacity onPress={() => router.push("login" as any)}> 
          <Text style={[styles.link, { color: colors.tint }]}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (!orders.length) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}> 
        <Text style={[styles.title, { color: colors.text }]}>No orders yet</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Your orders will appear here once you place one.</Text>
      </View>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ paddingBottom: 20 }}
        renderItem={({ item }) => {
          const createdAt = item.created_at ? new Date(item.created_at).toLocaleDateString() : ""
          const currency = (item as any).currency_code || (item as any).region?.currency_code
          const total = (item as any).total ?? 0

          return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}> 
              <Text style={[styles.orderId, { color: colors.text }]}>{item.id}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>Date: {createdAt}</Text>
              {item.status && (
                <Text style={[styles.meta, { color: colors.textSecondary }]}>Status: {item.status}</Text>
              )}
              <Text style={[styles.total, { color: colors.tint }]}>
                {currency ? formatPrice(total, currency) : ""}
              </Text>
            </View>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
  },
  link: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "600",
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  orderId: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 6,
  },
  meta: {
    fontSize: 13,
    marginBottom: 2,
  },
  total: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
  },
})
