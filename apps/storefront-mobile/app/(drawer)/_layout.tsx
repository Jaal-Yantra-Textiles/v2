import { Drawer } from "expo-router/drawer"
import { DrawerContent } from "@/components/drawer-content"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"

export default function DrawerLayout() {
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]

  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerPosition: "left",
        sceneStyle: { backgroundColor: colors.background },
        drawerStyle: { backgroundColor: colors.background },
      }}
    >
      <Drawer.Screen
        name="(tabs)"
        options={{
          drawerLabel: "Home",
          title: "Shop",
        }}
      />
    </Drawer>
  )
}
