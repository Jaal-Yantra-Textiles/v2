import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"

interface PartnerEmailVerificationSectionProps {
  partnerId: string
  partnerName: string
}

export const PartnerEmailVerificationSection = ({
  partnerId,
  partnerName,
}: PartnerEmailVerificationSectionProps) => {
  const queryClient = useQueryClient()
  const [bypassing, setBypassing] = useState(false)
  const [result, setResult] = useState<{
    verified: boolean
    already_verified: boolean
    email?: string
  } | null>(null)

  const handleBypass = async () => {
    setBypassing(true)
    try {
      const resp: any = await sdk.client.fetch(
        `/admin/partners/${partnerId}/bypass-email-verification`,
        { method: "POST" }
      )
      setResult(resp)
      if (resp.already_verified) {
        toast.success("Email already verified")
      } else {
        toast.success(`Email verification bypassed for ${resp.email}`)
      }
      queryClient.invalidateQueries({ queryKey: ["partner", partnerId] })
    } catch (e: any) {
      toast.error(e.message || "Failed to bypass email verification")
    } finally {
      setBypassing(false)
    }
  }

  const isVerified = result?.verified

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Email Verification</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {isVerified
              ? "Email is verified — partner can log in without verification"
              : "Not verified — partner login may require email verification"}
          </Text>
        </div>
        {isVerified && (
          <Badge color="green" size="small">Verified</Badge>
        )}
      </div>

      <div className="border-t border-ui-border-base px-6 py-4">
        <div className="space-y-3">
          {result?.email && (
            <div className="flex items-center justify-between">
              <div>
                <Text size="small" className="text-ui-fg-muted font-medium">Email</Text>
                <Text className="font-mono">{result.email}</Text>
              </div>
            </div>
          )}
          <Text size="xsmall" className="text-ui-fg-disabled">
            Bypasses the email verification gate for {partnerName}, allowing
            them to log in without confirming their email. Idempotent — safe
            to apply even if already verified.
          </Text>
          <Button
            size="small"
            variant="primary"
            onClick={handleBypass}
            isLoading={bypassing}
          >
            {result?.already_verified ? "Re-verify" : "Bypass Email Verification"}
          </Button>
        </div>
      </div>
    </Container>
  )
}
