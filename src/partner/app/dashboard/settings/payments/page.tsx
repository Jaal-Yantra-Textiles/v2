import { Container, Heading, Text } from "@medusajs/ui"
import { getPartnerPaymentMethods, getPartnerPayments } from "../../actions"
import PaymentMethodsTable from "./payment-methods-table"
import PaymentsTable from "./payments-table"


export default async function PaymentsSettingsPage() {
  const [methods, payments] = await Promise.all([
    getPartnerPaymentMethods(),
    getPartnerPayments(),
  ])

  return (
    <div className="flex flex-col gap-y-8">
      <div>
        <Heading level="h1">Payments</Heading>
        <Text className="text-ui-fg-subtle">Manage payment methods and view recent payments.</Text>
      </div>

      <Container className="p-0">
        <PaymentMethodsTable data={methods} />
      </Container>

      <Container className="p-0">
        <PaymentsTable data={payments} />
      </Container>
    </div>
  )
}
