import { Image } from "expo-image"
import React, { useEffect, useState } from "react"
import { FlatList, StyleSheet, Text, View, ActivityIndicator } from "react-native"
import { sdk } from "@/lib/medusa"
import { useRegion } from "@/context/region-context"
import { ProductCard } from "@/components/product-card"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import type { HttpTypes } from "@medusajs/types"

export default function HomeScreen() {
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { region } = useRegion()

  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchProducts = async () => {
      if (!region) return

      setIsLoading(true)
      try {
        const { products: fetchedProducts } = await sdk.store.product.list({
          region_id: region.id,
          limit: 20,
        })
        setProducts(fetchedProducts || [])
      } catch (error) {
        console.error("Failed to fetch products:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProducts()
  }, [region])

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.loadingText, { color: colors.icon }]}>Loading products...</Text>
      </View>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.hero}>
            <Image
              source={{ uri: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800" }}
              style={styles.heroImage}
              contentFit="cover"
            />
            <View style={styles.heroOverlay}>
              <Text style={styles.heroTitle}>Welcome to Our Store</Text>
              <Text style={styles.heroSubtitle}>Discover amazing products</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <ProductCard product={item} currencyCode={region?.currency_code} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.icon }]}>No products found</Text>
          </View>
        }
      />
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
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 8,
    paddingBottom: 20,
  },
  hero: {
    height: 200,
    marginBottom: 16,
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 8,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  heroTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  heroSubtitle: {
    color: "#fff",
    fontSize: 14,
    opacity: 0.9,
  },
  empty: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
  },
})
