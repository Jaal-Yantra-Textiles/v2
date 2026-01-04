import { Stack, useNavigation } from "expo-router"
import React from "react"
import { TouchableOpacity } from "react-native"
import { DrawerActions } from "@react-navigation/native"
import { IconSymbol } from "@/components/ui/icon-symbol"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"

export default function AccountStackLayout() {
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const navigation = useNavigation()

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        contentStyle: { backgroundColor: colors.background },
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
            style={{ height: 36, width: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <IconSymbol size={28} name="line.3.horizontal" color={colors.icon} />
          </TouchableOpacity>
        ),
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Account",
        }}
      />
      <Stack.Screen
        name="login"
        options={{
          title: "Login",
        }}
      />
      <Stack.Screen
        name="orders"
        options={{
          title: "Order History",
        }}
      />
      <Stack.Screen
        name="gift-cards"
        options={{
          title: "Gift Cards",
        }}
      />
    </Stack>
  )
}
