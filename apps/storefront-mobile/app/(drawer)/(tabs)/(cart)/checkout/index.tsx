import React, { useState, useEffect, useCallback } from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native"
import { useRouter } from "expo-router"
import { sdk } from "@/lib/medusa"
import { useCart } from "@/context/cart-context"
import { useRegion } from "@/context/region-context"
import { formatPrice } from "@/lib/format-price"
import { Colors } from "@/constants/theme"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { IconSymbol } from "@/components/ui/icon-symbol"
import type { HttpTypes } from "@medusajs/types"

type CheckoutStep = "delivery" | "shipping" | "payment"

interface CollapsibleSectionProps {
  title: string
  stepNumber: number
  isActive: boolean
  isCompleted: boolean
  onPress: () => void
  children: React.ReactNode
  colors: typeof Colors.light
}

function CollapsibleSection({
  title,
  stepNumber,
  isActive,
  isCompleted,
  onPress,
  children,
  colors,
}: CollapsibleSectionProps) {
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={onPress}
        disabled={!isCompleted && !isActive}
      >
        <View style={styles.sectionHeaderLeft}>
          <View
            style={[
              styles.stepBadge,
              {
                backgroundColor: isActive || isCompleted ? colors.tint : colors.border,
              },
            ]}
          >
            {isCompleted && !isActive ? (
              <IconSymbol size={14} name="checkmark" color="#fff" />
            ) : (
              <Text style={styles.stepBadgeText}>{stepNumber}</Text>
            )}
          </View>
          <Text
            style={[
              styles.sectionTitle,
              { color: isActive ? colors.text : colors.textSecondary },
            ]}
          >
            {title}
          </Text>
        </View>
        <IconSymbol
          size={20}
          name={isActive ? "chevron.up" : "chevron.down"}
          color={colors.icon}
        />
      </TouchableOpacity>
      {isActive && <View style={styles.sectionContent}>{children}</View>}
    </View>
  )
}

export default function CheckoutScreen() {
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { cart, refreshCart } = useCart()
  const { region } = useRegion()

  const [currentStep, setCurrentStep] = useState<CheckoutStep>("delivery")
  const [isLoading, setIsLoading] = useState(false)
  const [completedSteps, setCompletedSteps] = useState<CheckoutStep[]>([])

  const [shippingOptions, setShippingOptions] = useState<HttpTypes.StoreCartShippingOption[]>([])
  const [selectedShippingOption, setSelectedShippingOption] = useState<string | null>(null)
  const [paymentProviders, setPaymentProviders] = useState<HttpTypes.StorePaymentProvider[]>([])
  const [selectedPaymentProvider, setSelectedPaymentProvider] = useState<string | null>(null)

  const [address, setAddress] = useState({
    first_name: "",
    last_name: "",
    address_1: "",
    city: "",
    postal_code: "",
    country_code: region?.countries?.[0]?.iso_2 || "us",
    phone: "",
  })

  const [email, setEmail] = useState("")

  const fetchShippingOptions = useCallback(async () => {
    if (!cart?.id) return

    try {
      const { shipping_options } = await sdk.store.fulfillment.listCartOptions({ cart_id: cart.id })
      setShippingOptions(shipping_options || [])
      if (shipping_options?.length > 0 && !selectedShippingOption) {
        setSelectedShippingOption(shipping_options[0].id)
      }
    } catch (error) {
      console.error("Failed to fetch shipping options:", error)
    }
  }, [cart?.id, selectedShippingOption])

  const fetchPaymentProviders = useCallback(async () => {
    if (!region?.id) return

    try {
      const { payment_providers } = await sdk.store.payment.listPaymentProviders({ region_id: region.id })
      setPaymentProviders(payment_providers || [])
      if (payment_providers?.length > 0 && !selectedPaymentProvider) {
        setSelectedPaymentProvider(payment_providers[0].id)
      }
    } catch (error) {
      console.error("Failed to fetch payment providers:", error)
    }
  }, [region?.id, selectedPaymentProvider])

  useEffect(() => {
    if (currentStep === "shipping") {
      fetchShippingOptions()
    }
  }, [currentStep, fetchShippingOptions])

  useEffect(() => {
    if (currentStep === "payment") {
      fetchPaymentProviders()
    }
  }, [currentStep, fetchPaymentProviders])

  const handleUpdateAddress = async () => {
    if (!cart?.id) return

    if (!email || !address.first_name || !address.last_name || !address.address_1 || !address.city || !address.postal_code) {
      Alert.alert("Error", "Please fill in all required fields")
      return
    }

    setIsLoading(true)
    try {
      await sdk.store.cart.update(cart.id, {
        email,
        shipping_address: address,
        billing_address: address,
      })
      await refreshCart()
      setCompletedSteps((prev) => [...prev.filter((s) => s !== "delivery"), "delivery"])
      setCurrentStep("shipping")
    } catch (error) {
      console.error("Failed to update address:", error)
      Alert.alert("Error", "Failed to save delivery information")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectShipping = async () => {
    if (!cart?.id || !selectedShippingOption) {
      Alert.alert("Error", "Please select a shipping method")
      return
    }

    setIsLoading(true)
    try {
      await sdk.store.cart.addShippingMethod(cart.id, {
        option_id: selectedShippingOption,
      })
      await refreshCart()
      setCompletedSteps((prev) => [...prev.filter((s) => s !== "shipping"), "shipping"])
      setCurrentStep("payment")
    } catch (error) {
      console.error("Failed to add shipping method:", error)
      Alert.alert("Error", "Failed to save shipping method")
    } finally {
      setIsLoading(false)
    }
  }

  const handlePlaceOrder = async () => {
    if (!cart?.id || !selectedPaymentProvider) {
      Alert.alert("Error", "Please select a payment method")
      return
    }

    setIsLoading(true)
    try {
      // Initialize payment session first
      await sdk.store.payment.initiatePaymentSession(cart, {
        provider_id: selectedPaymentProvider,
      })

      // Refresh cart to get updated payment collection
      await refreshCart()

      // Complete the cart
      const result = await sdk.store.cart.complete(cart.id)

      if (result.type === "order" && result.order) {
        router.replace(`/order-confirmation/${result.order.id}`)
      } else {
        Alert.alert("Error", (result as any).error?.message || "Failed to complete order")
      }
    } catch (error: any) {
      console.error("Failed to place order:", error)
      Alert.alert("Error", error?.message || "Failed to place order")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSectionPress = (step: CheckoutStep) => {
    if (completedSteps.includes(step) || step === currentStep) {
      setCurrentStep(step)
    }
  }

  const getButtonText = () => {
    switch (currentStep) {
      case "delivery":
        return "Continue to Shipping"
      case "shipping":
        return "Continue to Payment"
      case "payment":
        return "Place Order"
    }
  }

  const handleContinue = () => {
    switch (currentStep) {
      case "delivery":
        handleUpdateAddress()
        break
      case "shipping":
        handleSelectShipping()
        break
      case "payment":
        handlePlaceOrder()
        break
    }
  }

  const isStepCompleted = (step: CheckoutStep) => completedSteps.includes(step)

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <CollapsibleSection
            title="Delivery Information"
            stepNumber={1}
            isActive={currentStep === "delivery"}
            isCompleted={isStepCompleted("delivery")}
            onPress={() => handleSectionPress("delivery")}
            colors={colors}
          >
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
              placeholder="Email"
              placeholderTextColor={colors.icon}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.halfInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                placeholder="First Name"
                placeholderTextColor={colors.icon}
                value={address.first_name}
                onChangeText={(text) => setAddress({ ...address, first_name: text })}
              />
              <TextInput
                style={[styles.input, styles.halfInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                placeholder="Last Name"
                placeholderTextColor={colors.icon}
                value={address.last_name}
                onChangeText={(text) => setAddress({ ...address, last_name: text })}
              />
            </View>

            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
              placeholder="Address"
              placeholderTextColor={colors.icon}
              value={address.address_1}
              onChangeText={(text) => setAddress({ ...address, address_1: text })}
            />

            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.halfInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                placeholder="City"
                placeholderTextColor={colors.icon}
                value={address.city}
                onChangeText={(text) => setAddress({ ...address, city: text })}
              />
              <TextInput
                style={[styles.input, styles.halfInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
                placeholder="Postal Code"
                placeholderTextColor={colors.icon}
                value={address.postal_code}
                onChangeText={(text) => setAddress({ ...address, postal_code: text })}
              />
            </View>

            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
              placeholder="Phone"
              placeholderTextColor={colors.icon}
              value={address.phone}
              onChangeText={(text) => setAddress({ ...address, phone: text })}
              keyboardType="phone-pad"
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Shipping Method"
            stepNumber={2}
            isActive={currentStep === "shipping"}
            isCompleted={isStepCompleted("shipping")}
            onPress={() => handleSectionPress("shipping")}
            colors={colors}
          >
            {shippingOptions.length === 0 ? (
              <Text style={[styles.paymentNote, { color: colors.textSecondary }]}>
                Loading shipping options...
              </Text>
            ) : (
              shippingOptions.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.shippingOption,
                    {
                      borderColor: selectedShippingOption === option.id ? colors.tint : colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={() => setSelectedShippingOption(option.id)}
                >
                  <View style={styles.shippingOptionLeft}>
                    <View
                      style={[
                        styles.radioSelected,
                        { borderColor: selectedShippingOption === option.id ? colors.tint : colors.border },
                      ]}
                    >
                      {selectedShippingOption === option.id && (
                        <View style={[styles.radioInner, { backgroundColor: colors.tint }]} />
                      )}
                    </View>
                    <View>
                      <Text style={[styles.shippingName, { color: colors.text }]}>{option.name}</Text>
                      <Text style={[styles.shippingTime, { color: colors.textSecondary }]}>
                        {(option as any).provider?.id || "Standard delivery"}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.shippingPrice, { color: colors.text }]}>
                    {option.amount ? formatPrice(option.amount, region?.currency_code) : "Free"}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Payment"
            stepNumber={3}
            isActive={currentStep === "payment"}
            isCompleted={isStepCompleted("payment")}
            onPress={() => handleSectionPress("payment")}
            colors={colors}
          >
            {paymentProviders.length === 0 ? (
              <Text style={[styles.paymentNote, { color: colors.textSecondary }]}>
                Loading payment options...
              </Text>
            ) : (
              paymentProviders.map((provider) => (
                <TouchableOpacity
                  key={provider.id}
                  style={[
                    styles.shippingOption,
                    {
                      borderColor: selectedPaymentProvider === provider.id ? colors.tint : colors.border,
                      backgroundColor: colors.card,
                      marginBottom: 8,
                    },
                  ]}
                  onPress={() => setSelectedPaymentProvider(provider.id)}
                >
                  <View style={styles.shippingOptionLeft}>
                    <View
                      style={[
                        styles.radioSelected,
                        { borderColor: selectedPaymentProvider === provider.id ? colors.tint : colors.border },
                      ]}
                    >
                      {selectedPaymentProvider === provider.id && (
                        <View style={[styles.radioInner, { backgroundColor: colors.tint }]} />
                      )}
                    </View>
                    <Text style={[styles.shippingName, { color: colors.text }]}>
                      {provider.id.replace("pp_", "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            )}

            <View style={[styles.orderSummary, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border, marginTop: 16 }]}>
              <Text style={[styles.summaryTitle, { color: colors.text }]}>Order Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={{ color: colors.textSecondary }}>Subtotal</Text>
                <Text style={{ color: colors.text }}>{formatPrice(cart?.subtotal || 0, region?.currency_code)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={{ color: colors.textSecondary }}>Shipping</Text>
                <Text style={{ color: colors.text }}>{formatPrice(cart?.shipping_total || 0, region?.currency_code)}</Text>
              </View>
              <View style={[styles.summaryRow, styles.totalRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>Total</Text>
                <Text style={[styles.totalValue, { color: colors.tint }]}>
                  {formatPrice(cart?.total || 0, region?.currency_code)}
                </Text>
              </View>
            </View>
          </CollapsibleSection>
        </ScrollView>

        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.continueButton, { backgroundColor: colors.tint }]}
            onPress={handleContinue}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.continueText}>{getButtonText()}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBadgeText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  shippingOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderWidth: 2,
    borderRadius: 10,
  },
  shippingOptionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  radioSelected: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  shippingName: {
    fontSize: 15,
    fontWeight: "500",
  },
  shippingTime: {
    fontSize: 13,
    marginTop: 2,
  },
  shippingPrice: {
    fontSize: 15,
    fontWeight: "600",
  },
  paymentNote: {
    fontSize: 14,
    marginBottom: 16,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  stepIndicators: {
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 20,
    gap: 40,
  },
  stepIndicator: {
    alignItems: "center",
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  stepNumber: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  stepLabel: {
    fontSize: 12,
  },
  stepContent: {
    padding: 16,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  stepDescription: {
    fontSize: 14,
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  continueButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  continueText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  orderSummary: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  totalRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  totalValue: {
    fontSize: 18,
    fontWeight: "700",
  },
})
