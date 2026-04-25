import { Tabs } from "expo-router"
import React from "react"
import { IconSymbol } from "@/components/ui/icon-symbol"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { HapticTab } from "@/components/haptic-tab"
import { useCart } from "@/context/cart-context"

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const { cart } = useCart()
  const colors = Colors[colorScheme ?? "light"]

  const itemCount = cart?.items?.length || 0

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.icon,
        headerShown: false,
        tabBarButton: HapticTab,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(cart)"
        options={{
          title: "Cart",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="cart.fill" color={color} />,
          tabBarBadge: itemCount > 0 ? itemCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.tint,
          },
        }}
      />
      <Tabs.Screen
        name="(account)"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.fill" color={color} />,
        }}
      />
    </Tabs>
  )
}
