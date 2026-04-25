import React from "react"
import { StyleSheet, Text, TouchableOpacity, View, ScrollView } from "react-native"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { useRegion } from "@/context/region-context"
import { IconSymbol } from "@/components/ui/icon-symbol"

export function RegionSelector() {
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { region, regions, setRegion, isLoading } = useRegion()

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={[styles.loadingText, { color: colors.icon }]}>Loading regions...</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Select Region</Text>
      <Text style={[styles.subtitle, { color: colors.icon }]}>
        Choose your country to see local prices and shipping options
      </Text>

      {regions?.map((r) => {
        const isSelected = region?.id === r.id
        const countryName = r.countries?.[0]?.display_name || r.name

        return (
          <TouchableOpacity
            key={r.id}
            style={[
              styles.regionItem,
              { borderColor: isSelected ? colors.tint : colors.icon + "30" },
              isSelected && { backgroundColor: colors.tint + "10" },
            ]}
            onPress={() => setRegion(r)}
          >
            <View style={styles.regionInfo}>
              <Text style={[styles.regionName, { color: colors.text }]}>{countryName}</Text>
              <Text style={[styles.regionCurrency, { color: colors.icon }]}>
                {r.currency_code?.toUpperCase()}
              </Text>
            </View>
            {isSelected && <IconSymbol size={20} name="checkmark" color={colors.tint} />}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  loadingText: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 20,
  },
  regionItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  regionInfo: {
    flex: 1,
  },
  regionName: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 2,
  },
  regionCurrency: {
    fontSize: 12,
  },
})
