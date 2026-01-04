import React from "react"
import { StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { Button } from "@/components/ui/button"
import { Loading } from "@/components/loading"
import { useCustomer } from "@/context/customer-context"

export default function AccountScreen() {
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { customer, isLoading, logout } = useCustomer()

  if (isLoading) {
    return <Loading message="Loading account..." />
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {customer ? (
        <>
          <Text style={[styles.title, { color: colors.text }]}>Hi{customer.first_name ? `, ${customer.first_name}` : ""}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Manage your orders and gift cards</Text>

          <View style={styles.section}>
            <Button title="Order History" onPress={() => router.push("orders" as any)} />
            <Button
              title="Gift Cards"
              variant="secondary"
              onPress={() => router.push("gift-cards" as any)} 
              style={{ marginTop: 12 }}
            />
          </View>

          <View style={styles.section}>
            <Button
              title="Log Out"
              variant="outline"
              onPress={() => {
                logout().catch(() => {})
              }}
            />
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: colors.text }]}>Account</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Log in to see your order history and gift cards.</Text>
          <View style={styles.section}>
            <Button title="Login" onPress={() => router.push("login" as any)} />
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 18,
  },
  section: {
    marginTop: 12,
  },
})
