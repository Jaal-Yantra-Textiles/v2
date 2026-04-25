import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { ThemeProvider, useTheme } from '@/context/theme-context';
import { RegionProvider } from '@/context/region-context';
import { CartProvider } from '@/context/cart-context';
import { CustomerProvider } from '@/context/customer-context';

export const unstable_settings = {
  anchor: '(drawer)',
};

function RootLayoutNav() {
  const { isDark, colors } = useTheme();

  const navigationTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: colors.background,
          card: colors.card,
          text: colors.text,
          border: colors.border,
          primary: colors.tint,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: colors.background,
          card: colors.card,
          text: colors.text,
          border: colors.border,
          primary: colors.tint,
        },
      }

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <RegionProvider>
        <CustomerProvider>
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
        </CustomerProvider>
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
