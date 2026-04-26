import { useState, useMemo } from "react"
import { Button, Heading, Text, Select, Input, Label, toast } from "@medusajs/ui"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../components/modal/use-route-modal"
import { usePartners } from "../../../hooks/api/partners-admin"
import { useCreateConversation } from "../../../hooks/api/messaging"

const CreateConversationComponent = () => {
  const [selectedPartnerId, setSelectedPartnerId] = useState("")
  const [selectedPhone, setSelectedPhone] = useState("")
  const [customPhone, setCustomPhone] = useState("")

  const { handleSuccess } = useRouteModal()
  const createConversation = useCreateConversation()

  const { partners = [], isPending: loadingPartners } = usePartners(
    { limit: 100, fields: ["id", "name", "handle", "whatsapp_number", "whatsapp_verified", "admins.*"] },
  )

  const phoneOptions = useMemo(() => {
    if (!selectedPartnerId) return []
    const partner = partners.find((p: any) => p.id === selectedPartnerId) as any
    if (!partner) return []

    const phones: { label: string; value: string }[] = []

    if (partner.whatsapp_number && partner.whatsapp_verified) {
      phones.push({
        label: `${partner.whatsapp_number} (WhatsApp verified)`,
        value: partner.whatsapp_number,
      })
    } else if (partner.whatsapp_number) {
      phones.push({
        label: `${partner.whatsapp_number} (unverified)`,
        value: partner.whatsapp_number,
      })
    }

    for (const admin of partner.admins || []) {
      if (admin.phone) {
        const name = [admin.first_name, admin.last_name].filter(Boolean).join(" ") || admin.email
        phones.push({
          label: `${admin.phone} (${name})`,
          value: admin.phone,
        })
      }
    }

    return phones
  }, [selectedPartnerId, partners])

  const finalPhone = selectedPhone === "__custom__" ? customPhone : selectedPhone

  const handleCreate = async () => {
    if (!selectedPartnerId || !finalPhone) return
    try {
      const result = await createConversation.mutateAsync({
        partner_id: selectedPartnerId,
        phone_number: finalPhone,
      })
      toast.success("Conversation started")
      handleSuccess(`/messaging/${result.conversation.id}`)
    } catch (e: any) {
      toast.error(e.message || "Failed to create conversation")
    }
  }

  return (
    <>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 md:py-16 px-4 md:px-6">
        <div className="flex w-full max-w-[720px] flex-col gap-y-6 md:gap-y-8">
          <div>
            <Heading className="text-xl md:text-2xl">New Conversation</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Start a WhatsApp conversation with a partner
            </Text>
          </div>

          {/* Partner select */}
          <div>
            <Label htmlFor="partner" className="mb-1.5 block">Partner</Label>
            <Select
              value={selectedPartnerId}
              onValueChange={(val) => {
                setSelectedPartnerId(val)
                setSelectedPhone("")
                setCustomPhone("")
              }}
            >
              <Select.Trigger>
                <Select.Value placeholder={loadingPartners ? "Loading..." : "Select a partner"} />
              </Select.Trigger>
              <Select.Content>
                {partners.map((p: any) => (
                  <Select.Item key={p.id} value={p.id}>
                    {p.name} ({p.handle})
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          {/* Phone number */}
          {selectedPartnerId && (
            <div>
              <Label htmlFor="phone" className="mb-1.5 block">Phone Number</Label>
              {phoneOptions.length > 0 ? (
                <Select
                  value={selectedPhone}
                  onValueChange={setSelectedPhone}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Select a phone number" />
                  </Select.Trigger>
                  <Select.Content>
                    {phoneOptions.map((opt) => (
                      <Select.Item key={opt.value} value={opt.value}>
                        {opt.label}
                      </Select.Item>
                    ))}
                    <Select.Item value="__custom__">
                      Enter custom number...
                    </Select.Item>
                  </Select.Content>
                </Select>
              ) : (
                <>
                  <Text size="small" className="text-ui-fg-muted mb-2">
                    No phone numbers found. Enter one manually.
                  </Text>
                  <Input
                    value={customPhone}
                    onChange={(e) => {
                      setCustomPhone(e.target.value)
                      setSelectedPhone("__custom__")
                    }}
                    placeholder="+91XXXXXXXXXX"
                  />
                </>
              )}

              {selectedPhone === "__custom__" && phoneOptions.length > 0 && (
                <div className="mt-2">
                  <Input
                    value={customPhone}
                    onChange={(e) => setCustomPhone(e.target.value)}
                    placeholder="+91XXXXXXXXXX"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer className="px-4 py-3 md:px-6 md:py-4">
        <div className="flex flex-col-reverse sm:flex-row justify-end items-center gap-y-2 gap-x-2 w-full">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary" className="w-full sm:w-auto">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            variant="primary"
            onClick={handleCreate}
            disabled={!selectedPartnerId || !finalPhone || createConversation.isPending}
            isLoading={createConversation.isPending}
            className="w-full sm:w-auto"
          >
            Start Conversation
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

const CreateConversationModal = () => {
  return (
    <RouteFocusModal prev="/messaging">
      <CreateConversationComponent />
    </RouteFocusModal>
  )
}

export default CreateConversationModal
