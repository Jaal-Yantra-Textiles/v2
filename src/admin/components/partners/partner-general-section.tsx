import { Badge, Button, Container, Heading, Input, Label, Select, Switch, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useUpdatePartner } from "../../hooks/api/partners-admin"

export type AdminPartner = {
  id: string
  name: string
  handle: string
  logo?: string | null
  status: "active" | "inactive" | "pending"
  is_verified: boolean
  metadata?: Record<string, any> | null
}

export const PartnerGeneralSection = ({ partner }: { partner: AdminPartner }) => {
  const [name, setName] = useState(partner.name)
  const [handle, setHandle] = useState(partner.handle)
  const [logo, setLogo] = useState(partner.logo || "")
  const [status, setStatus] = useState<"active" | "inactive" | "pending">(partner.status)
  const [isVerified, setIsVerified] = useState<boolean>(!!partner.is_verified)

  const { mutateAsync: updatePartner, isPending } = useUpdatePartner()

  // Sync local state if the partner prop updates (e.g., after a successful save/refetch)
  useEffect(() => {
    setName(partner.name)
    setHandle(partner.handle)
    setLogo(partner.logo || "")
    setStatus(partner.status)
    setIsVerified(!!partner.is_verified)
  }, [partner.id, partner.name, partner.handle, partner.logo, partner.status, partner.is_verified])

  const isDirty = useMemo(() => {
    const norm = (v: string | null | undefined) => (v || "").trim()
    return (
      norm(name) !== norm(partner.name) ||
      norm(handle) !== norm(partner.handle) ||
      norm(logo) !== norm(partner.logo) ||
      status !== partner.status ||
      Boolean(isVerified) !== Boolean(partner.is_verified)
    )
  }, [name, handle, logo, status, isVerified, partner.name, partner.handle, partner.logo, partner.status, partner.is_verified])

  const onSave = async () => {
    try {
      await updatePartner({ id: partner.id, data: { name, handle, logo: logo || null, status, is_verified: isVerified } })
      toast.success("Partner updated", { description: "Your changes have been saved." })
    } catch (e: any) {
      toast.error("Update failed", { description: e?.message || "Could not update partner" })
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-start justify-between px-6 py-4">
        <div>
          <Heading level="h2">General</Heading>
          <Text size="small" className="text-ui-fg-subtle">Basic information for this partner</Text>
        </div>
        <div className="flex items-center gap-2">
          <Badge color={status === "active" ? "green" : status === "pending" ? "orange" : "grey"}>{status}</Badge>
          {isVerified ? <Badge color="green">Verified</Badge> : <Badge>Not Verified</Badge>}
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label size="small">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label size="small">Handle</Label>
            <Input value={handle} onChange={(e) => setHandle(e.target.value)} />
          </div>
          <div>
            <Label size="small">Logo URL</Label>
            <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label size="small">Status</Label>
            <Select value={status} onValueChange={(v: string) => setStatus(v as any)}>
              <Select.Trigger>
                <Select.Value placeholder="Select status" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="active">Active</Select.Item>
                <Select.Item value="inactive">Inactive</Select.Item>
                <Select.Item value="pending">Pending</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Switch checked={isVerified} onCheckedChange={setIsVerified} />
            <Label size="small">Verified</Label>
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="small" onClick={onSave} disabled={!isDirty || isPending} variant={isDirty ? "primary" : "secondary"}>
            Save
          </Button>
        </div>
      </div>
    </Container>
  )
}
