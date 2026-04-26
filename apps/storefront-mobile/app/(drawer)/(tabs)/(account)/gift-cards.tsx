import React, { useState } from "react"
import { Alert, StyleSheet, Text, TextInput, View } from "react-native"
import type { HttpTypes } from "@medusajs/types"
import { sdk } from "@/lib/medusa"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { Button } from "@/components/ui/button"
import { useCart } from "@/context/cart-context"

export default function GiftCardsScreen() {
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { cart, refreshCart } = useCart()

  const [code, setCode] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleApply = async () => {
    if (!cart?.id) {
      Alert.alert("Error", "No cart found")
      return
    }

    if (!code.trim()) {
      Alert.alert("Error", "Please enter a gift card code")
      return
    }

    setIsSubmitting(true)
    try {
      await sdk.client.fetch<{ cart: HttpTypes.StoreCart }>(`/store/carts/${cart.id}/gift-cards`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: {
          code: code.trim(),
        },
      })

      await refreshCart()
      setCode("")
      Alert.alert("Success", "Gift card applied to cart")
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to apply gift card")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <Text style={[styles.title, { color: colors.text }]}>Apply Gift Card</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Enter a gift card code to apply it to your current cart.</Text>

      <TextInput
        style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
        placeholder="CODE"
        placeholderTextColor={colors.icon}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
      />

      <View style={{ marginTop: 16 }}>
        <Button title="Apply" onPress={handleApply} loading={isSubmitting} />
      </View>

      <View style={{ marginTop: 20 }}>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Current cart: {cart?.id || "-"}</Text>
      </View>
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
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  hint: {
    fontSize: 12,
  },
})
