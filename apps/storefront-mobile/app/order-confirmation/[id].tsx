import React, { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { useLocalSearchParams, useRouter } from "expo-router"
import { sdk } from "@/lib/medusa"
import { useCart } from "@/context/cart-context"
import { Loading } from "@/components/loading"
import { Button } from "@/components/ui/button"
import { IconSymbol } from "@/components/ui/icon-symbol"
import { formatPrice } from "@/lib/format-price"
import { getPaymentProviderInfo } from "@/lib/payment-providers"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import type { HttpTypes } from "@medusajs/types"

export default function OrderConfirmationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { clearCart } = useCart()

  const [order, setOrder] = useState<HttpTypes.StoreOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasCleared = useRef(false)

  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const { order: fetchedOrder } = await sdk.store.order.retrieve(id, {
        fields: "*payment_collections.payments",
      })
      setOrder(fetchedOrder)
    } catch (err) {
      console.error("Failed to fetch order:", err)
      setError("Failed to load order details")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (id) {
      fetchOrder()
    }
  }, [id, fetchOrder])

  useEffect(() => {
    if (!hasCleared.current) {
      hasCleared.current = true
      clearCart()
    }
  }, [clearCart])

  const handleContinueShopping = () => {
    router.dismissAll()
    router.replace("/(drawer)/(tabs)/(home)")
  }

  if (loading) {
    return <Loading message="Loading order details..." />
  }

  if (error || !order) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.text }]}>
          {error || "Order not found"}
        </Text>
        <Button title="Go to Home" onPress={handleContinueShopping} style={styles.button} />
      </View>
    )
  }

  const paymentInfo = order.payment_collections?.[0]?.payments?.[0]
  const providerInfo = paymentInfo?.provider_id
    ? getPaymentProviderInfo(paymentInfo.provider_id)
    : null

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.successIcon, { backgroundColor: colors.success }]}>
          <Text style={styles.checkmark}>✓</Text>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Order Confirmed!</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          We have received your order and will process it as soon as possible.
        </Text>

        <Button
          title="Continue Shopping"
          onPress={handleContinueShopping}
          style={styles.continueButton}
        />

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Order Details</Text>

          <View style={styles.infoRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Order ID</Text>
            <Text style={[styles.value, { color: colors.text }]}>#{order.display_id}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
            <Text style={[styles.value, { color: colors.text }]}>{order.email}</Text>
          </View>

          {providerInfo && (
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Payment</Text>
              <View style={styles.paymentInfo}>
                <IconSymbol size={16} name={providerInfo.icon as any} color={colors.text} />
                <Text style={[styles.value, { color: colors.text, marginLeft: 6 }]}>
                  {providerInfo.name}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Order Items</Text>

          {order.items?.map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.itemRow,
                index === (order.items?.length ?? 0) - 1 && styles.lastItemRow,
                { borderBottomColor: colors.border },
              ]}
            >
              <Image
                source={{ uri: item.thumbnail || "https://via.placeholder.com/60" }}
                style={[styles.itemImage, { backgroundColor: colors.backgroundSecondary }]}
                contentFit="cover"
              />
              <View style={styles.itemInfo}>
                <Text style={[styles.itemTitle, { color: colors.text }]}>
                  {item.product_title || item.title}
                </Text>
                {item.variant_title && (
                  <Text style={[styles.itemVariant, { color: colors.textSecondary }]}>
                    {item.variant_title}
                  </Text>
                )}
                <Text style={[styles.itemQuantity, { color: colors.textSecondary }]}>
                  Qty: {item.quantity}
                </Text>
              </View>
              <Text style={[styles.itemPrice, { color: colors.text }]}>
                {formatPrice(item.subtotal ?? 0, order.currency_code)}
              </Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Order Summary</Text>

          <View style={styles.summaryRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Subtotal</Text>
            <Text style={[styles.value, { color: colors.text }]}>
              {formatPrice(order.subtotal ?? 0, order.currency_code)}
            </Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Shipping</Text>
            <Text style={[styles.value, { color: colors.text }]}>
              {formatPrice(order.shipping_total ?? 0, order.currency_code)}
            </Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Tax</Text>
            <Text style={[styles.value, { color: colors.text }]}>
              {formatPrice(order.tax_total ?? 0, order.currency_code)}
            </Text>
          </View>

          <View style={[styles.summaryRow, styles.totalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>Total</Text>
            <Text style={[styles.totalValue, { color: colors.tint }]}>
              {formatPrice(order.total ?? 0, order.currency_code)}
            </Text>
          </View>
        </View>

        {order.shipping_address && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Shipping Address</Text>
            <Text style={[styles.addressText, { color: colors.text }]}>
              {order.shipping_address.first_name} {order.shipping_address.last_name}
            </Text>
            <Text style={[styles.addressText, { color: colors.textSecondary }]}>
              {order.shipping_address.address_1}
            </Text>
            <Text style={[styles.addressText, { color: colors.textSecondary }]}>
              {order.shipping_address.city}, {order.shipping_address.postal_code}
            </Text>
            <Text style={[styles.addressText, { color: colors.textSecondary }]}>
              {order.shipping_address.country_code?.toUpperCase()}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 20,
  },
  checkmark: {
    color: "#fff",
    fontSize: 40,
    fontWeight: "bold",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
  },
  errorText: {
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    marginTop: 16,
  },
  continueButton: {
    marginBottom: 24,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
  },
  value: {
    fontSize: 14,
    fontWeight: "500",
  },
  paymentInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  itemRow: {
    flexDirection: "row",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  lastItemRow: {
    borderBottomWidth: 0,
  },
  itemImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  itemVariant: {
    fontSize: 12,
    marginBottom: 2,
  },
  itemQuantity: {
    fontSize: 12,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: "600",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  totalRow: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  totalValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  addressText: {
    fontSize: 14,
    marginBottom: 4,
  },
})
