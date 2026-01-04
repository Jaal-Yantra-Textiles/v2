import React from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useTheme } from "@/context/theme-context"
import { IconSymbol } from "@/components/ui/icon-symbol"

type ThemeOption = {
  mode: "light" | "dark" | "system"
  label: string
  icon: "sun.max.fill" | "moon.fill" | "circle.lefthalf.filled"
}

const themeOptions: ThemeOption[] = [
  { mode: "light", label: "Light", icon: "sun.max.fill" },
  { mode: "dark", label: "Dark", icon: "moon.fill" },
  { mode: "system", label: "System", icon: "circle.lefthalf.filled" },
]

export function ThemeSelector() {
  const { mode, setMode, colors } = useTheme()

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Appearance</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Choose your preferred theme
      </Text>

      <View style={styles.options}>
        {themeOptions.map((option) => {
          const isSelected = mode === option.mode

          return (
            <TouchableOpacity
              key={option.mode}
              style={[
                styles.option,
                { borderColor: isSelected ? colors.tint : colors.border },
                isSelected && { backgroundColor: colors.tint + "15" },
              ]}
              onPress={() => setMode(option.mode)}
            >
              <IconSymbol
                size={24}
                name={option.icon}
                color={isSelected ? colors.tint : colors.icon}
              />
              <Text
                style={[
                  styles.optionLabel,
                  { color: isSelected ? colors.tint : colors.text },
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    marginTop: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 16,
  },
  options: {
    flexDirection: "row",
    gap: 8,
  },
  option: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 4,
  },
})
