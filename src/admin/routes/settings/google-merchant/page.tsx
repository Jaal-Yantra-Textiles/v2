import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShoppingCart } from "@medusajs/icons"
import { Button, Container, Heading, Text, StatusBadge, Table } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { useGoogleMerchantAccounts } from "../../../hooks/api/google-merchant"

const GoogleMerchantPage = () => {
  const navigate = useNavigate()
  const { accounts, count, isLoading } = useGoogleMerchantAccounts({ limit: 50 })

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
        <div>
          <Heading>Google Merchant Center</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Connect and manage Google Merchant Center accounts for product syncing
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          <Button size="small" variant="secondary" onClick={() => navigate("/settings/external-platforms")}>
            Back to External Platforms
          </Button>
          <Button size="small" variant="primary" onClick={() => navigate("/settings/google-merchant/create")}>
            Add Account
          </Button>
        </div>
      </div>

      <div className="px-6 py-4">
        {isLoading ? (
          <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
        ) : count === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No Google Merchant accounts yet. Click "Add Account" to connect one.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Merchant ID</Table.HeaderCell>
                <Table.HeaderCell>Email</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {accounts.map((a) => (
                <Table.Row
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/settings/google-merchant/${a.id}`)}
                >
                  <Table.Cell>{a.name}</Table.Cell>
                  <Table.Cell>{a.merchant_id}</Table.Cell>
                  <Table.Cell>{a.account_email || "—"}</Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={a.connected ? "green" : "orange"}>
                      {a.connected ? "Connected" : "Not connected"}
                    </StatusBadge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Google Merchant",
  icon: ShoppingCart,
})

export const handle = {
  breadcrumb: () => "Google Merchant",
}

export default GoogleMerchantPage
