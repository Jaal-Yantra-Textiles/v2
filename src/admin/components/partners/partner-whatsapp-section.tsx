import { Badge, Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"

interface PartnerWhatsAppSectionProps {
  partnerId: string
  partnerName: string
  whatsappNumber?: string | null
  whatsappVerified?: boolean
}

export const PartnerWhatsAppSection = ({
  partnerId,
  partnerName,
  whatsappNumber,
  whatsappVerified,
}: PartnerWhatsAppSectionProps) => {
  const queryClient = useQueryClient()
  const [phone, setPhone] = useState(whatsappNumber || "")
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const isConnected = !!whatsappNumber && !!whatsappVerified

  const handleConnect = async () => {
    const normalized = phone.replace(/[^0-9]/g, "")
    if (normalized.length < 10) {
      toast.error("Enter a valid phone number with country code")
      return
    }

    setConnecting(true)
    try {
      const resp: any = await sdk.client.fetch(
        `/admin/partners/${partnerId}/whatsapp-verify`,
        {
          method: "POST",
          body: { phone: normalized },
        }
      )

      if (resp.template_sent) {
        toast.success(`Welcome template sent to ${normalized}`)
      } else {
        toast.warning("Number saved but template could not be sent. Check WhatsApp config.")
      }

      queryClient.invalidateQueries({ queryKey: ["partner", partnerId] })
    } catch (e: any) {
      toast.error(e.message || "Failed to connect")
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await sdk.client.fetch(
        `/admin/partners/${partnerId}/whatsapp-verify`,
        { method: "DELETE" }
      )
      toast.success("WhatsApp disconnected")
      setPhone("")
      queryClient.invalidateQueries({ queryKey: ["partner", partnerId] })
    } catch (e: any) {
      toast.error(e.message || "Failed to disconnect")
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">WhatsApp</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {isConnected
              ? "Connected — partner will receive templates on this number"
              : "Not connected — connect to send production run notifications"}
          </Text>
        </div>
        {isConnected && (
          <Badge color="green" size="small">Connected</Badge>
        )}
      </div>

      <div className="border-t border-ui-border-base px-6 py-4">
        {isConnected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Text size="small" className="text-ui-fg-muted font-medium">Number</Text>
                <Text className="font-mono">{whatsappNumber}</Text>
              </div>
              <Button
                size="small"
                variant="secondary"
                onClick={handleDisconnect}
                isLoading={disconnecting}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Text size="xsmall" className="mb-1 text-ui-fg-muted font-medium">
                Phone number (with country code)
              </Text>
              <Input
                size="small"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 919876543210"
              />
            </div>
            <Text size="xsmall" className="text-ui-fg-disabled">
              A welcome template will be sent to this number. When the partner replies,
              they will go through consent and language selection to complete onboarding.
            </Text>
            <Button
              size="small"
              variant="primary"
              onClick={handleConnect}
              isLoading={connecting}
              disabled={!phone.trim()}
            >
              Connect on WhatsApp
            </Button>
          </div>
        )}
      </div>
    </Container>
  )
}
