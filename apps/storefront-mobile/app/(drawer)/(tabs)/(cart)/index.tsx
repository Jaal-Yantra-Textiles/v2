import React from "react"
import { FlatList, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from "react-native"
import { useRouter } from "expo-router"
import { useCart } from "@/context/cart-context"
import { useRegion } from "@/context/region-context"
import { CartItem } from "@/components/cart-item"
import { formatPrice } from "@/lib/format-price"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"

export default function CartScreen() {
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { cart, isLoading, updateItem, removeItem } = useCart()
  const { region } = useRegion()

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    )
  }

  const items = cart?.items || []
  const subtotal = cart?.subtotal || 0
  const currencyCode = cart?.currency_code || region?.currency_code

  if (items.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Your cart is empty</Text>
        <Text style={[styles.emptySubtitle, { color: colors.icon }]}>
          Add some products to get started
        </Text>
      </View>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CartItem
            item={item}
            currencyCode={currencyCode}
            onUpdateQuantity={(quantity) => updateItem(item.id, quantity)}
            onRemove={() => removeItem(item.id)}
          />
        )}
      />

      <View style={[styles.footer, { borderTopColor: colors.icon + "30" }]}>
        <View style={styles.subtotalRow}>
          <Text style={[styles.subtotalLabel, { color: colors.icon }]}>Subtotal</Text>
          <Text style={[styles.subtotalValue, { color: colors.text }]}>
            {formatPrice(subtotal, currencyCode)}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.checkoutButton, { backgroundColor: colors.tint }]}
          onPress={() => router.push("/(drawer)/(tabs)/(cart)/checkout")}
        >
          <Text style={styles.checkoutText}>Proceed to Checkout</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  subtotalLabel: {
    fontSize: 16,
  },
  subtotalValue: {
    fontSize: 18,
    fontWeight: "600",
  },
  checkoutButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  checkoutText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
})
