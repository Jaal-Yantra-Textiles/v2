import React from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"

interface LoadingProps {
  message?: string
}

export function Loading({ message = "Loading..." }: LoadingProps) {
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.tint} />
      {message && (
        <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  message: {
    marginTop: 12,
    fontSize: 14,
  },
})
