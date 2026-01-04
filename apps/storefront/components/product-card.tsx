import { Image } from "expo-image"
import { useRouter } from "expo-router"
import React from "react"
import { StyleSheet, Text, Pressable, View } from "react-native"
import { formatPrice } from "@/lib/format-price"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import type { HttpTypes } from "@medusajs/types"

interface ProductCardProps {
  product: HttpTypes.StoreProduct
  currencyCode?: string
}

export function ProductCard({ product, currencyCode }: ProductCardProps) {
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]

  const price = product.variants?.[0]?.calculated_price?.calculated_amount ?? undefined
  const thumbnail = product.thumbnail

  const handlePress = () => {
    router.push(`/(drawer)/(tabs)/(home)/product/${product.id}`)
  }

  return (
    <Pressable
      style={[styles.container, { backgroundColor: colors.card }]}
      onPress={handlePress}
    >
      <Image
        source={{ uri: thumbnail || "https://via.placeholder.com/200" }}
        style={[styles.image, { backgroundColor: colors.imagePlaceholder }]}
        contentFit="cover"
      />
      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {product.title}
        </Text>
        <Text style={[styles.price, { color: colors.tint }]}>
          {formatPrice(price, currencyCode)}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    margin: 8,
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  image: {
    width: "100%",
    aspectRatio: 1,
  },
  info: {
    padding: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  price: {
    fontSize: 16,
    fontWeight: "600",
  },
})
