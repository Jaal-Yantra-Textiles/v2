import { Image } from "expo-image"
import { useLocalSearchParams } from "expo-router"
import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { sdk } from "@/lib/medusa"
import { useRegion } from "@/context/region-context"
import { useCart } from "@/context/cart-context"
import { formatPrice } from "@/lib/format-price"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import type { HttpTypes } from "@medusajs/types"

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { region } = useRegion()
  const { addItem } = useCart()

  const [product, setProduct] = useState<HttpTypes.StoreProduct | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<HttpTypes.StoreProductVariant | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isAddingToCart, setIsAddingToCart] = useState(false)

  useEffect(() => {
    const fetchProduct = async () => {
      if (!id || !region) return

      setIsLoading(true)
      try {
        const { product: fetchedProduct } = await sdk.store.product.retrieve(id, {
          region_id: region.id,
        })
        setProduct(fetchedProduct)
        if (fetchedProduct?.variants?.length) {
          setSelectedVariant(fetchedProduct.variants[0])
        }
      } catch (error) {
        console.error("Failed to fetch product:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProduct()
  }, [id, region])

  const handleAddToCart = async () => {
    if (!selectedVariant) return

    setIsAddingToCart(true)
    try {
      await addItem(selectedVariant.id, quantity)
      // Could show a toast here
    } catch (error) {
      console.error("Failed to add to cart:", error)
    } finally {
      setIsAddingToCart(false)
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    )
  }

  if (!product) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.icon }]}>Product not found</Text>
      </View>
    )
  }

  const price = selectedVariant?.calculated_price?.calculated_amount ?? undefined

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <Image
        source={{ uri: product.thumbnail || "https://via.placeholder.com/400" }}
        style={styles.image}
        contentFit="cover"
      />

      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>{product.title}</Text>
        <Text style={[styles.price, { color: colors.tint }]}>
          {formatPrice(price, region?.currency_code)}
        </Text>

        {product.description && (
          <Text style={[styles.description, { color: colors.icon }]}>{product.description}</Text>
        )}

        {/* Variant selector */}
        {product.variants && product.variants.length > 1 && (
          <View style={styles.variantsSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Options</Text>
            <View style={styles.variantsList}>
              {product.variants.map((variant) => (
                <TouchableOpacity
                  key={variant.id}
                  style={[
                    styles.variantButton,
                    { borderColor: selectedVariant?.id === variant.id ? colors.tint : colors.icon },
                    selectedVariant?.id === variant.id && { backgroundColor: colors.tint + "20" },
                  ]}
                  onPress={() => setSelectedVariant(variant)}
                >
                  <Text
                    style={[
                      styles.variantText,
                      { color: selectedVariant?.id === variant.id ? colors.tint : colors.text },
                    ]}
                  >
                    {variant.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Quantity selector */}
        <View style={styles.quantitySection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Quantity</Text>
          <View style={styles.quantityControls}>
            <TouchableOpacity
              style={[styles.quantityButton, { borderColor: colors.icon }]}
              onPress={() => setQuantity(Math.max(1, quantity - 1))}
            >
              <Text style={[styles.quantityButtonText, { color: colors.text }]}>-</Text>
            </TouchableOpacity>
            <Text style={[styles.quantityValue, { color: colors.text }]}>{quantity}</Text>
            <TouchableOpacity
              style={[styles.quantityButton, { borderColor: colors.icon }]}
              onPress={() => setQuantity(quantity + 1)}
            >
              <Text style={[styles.quantityButtonText, { color: colors.text }]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Add to cart button */}
        <TouchableOpacity
          style={[styles.addToCartButton, { backgroundColor: colors.tint }]}
          onPress={handleAddToCart}
          disabled={isAddingToCart || !selectedVariant}
        >
          {isAddingToCart ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.addToCartText}>Add to Cart</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
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
  },
  errorText: {
    fontSize: 16,
  },
  image: {
    width: "100%",
    aspectRatio: 1,
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 8,
  },
  price: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  variantsSection: {
    marginBottom: 24,
  },
  variantsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  variantButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  variantText: {
    fontSize: 14,
    fontWeight: "500",
  },
  quantitySection: {
    marginBottom: 24,
  },
  quantityControls: {
    flexDirection: "row",
    alignItems: "center",
  },
  quantityButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  quantityButtonText: {
    fontSize: 20,
    fontWeight: "600",
  },
  quantityValue: {
    fontSize: 18,
    fontWeight: "600",
    marginHorizontal: 20,
  },
  addToCartButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addToCartText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
})
