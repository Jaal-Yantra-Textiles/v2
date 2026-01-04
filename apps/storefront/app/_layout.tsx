import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { ThemeProvider, useTheme } from '@/context/theme-context';
import { RegionProvider } from '@/context/region-context';
import { CartProvider } from '@/context/cart-context';

export const unstable_settings = {
  anchor: '(drawer)',
};

function RootLayoutNav() {
  const { isDark } = useTheme();

  return (
    <NavigationThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <RegionProvider>
        <CartProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen
              name="order-confirmation/[id]"
              options={{
                headerShown: true,
                title: "Order Confirmation",
                headerBackVisible: false,
              }}
            />
          </Stack>
          <StatusBar style={isDark ? "light" : "dark"} />
        </CartProvider>
      </RegionProvider>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <RootLayoutNav />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
