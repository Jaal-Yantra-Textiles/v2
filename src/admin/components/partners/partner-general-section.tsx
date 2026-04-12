import { Badge, Button, Container, Heading, Input, Label, Select, Switch, Text, toast, usePrompt } from "@medusajs/ui"
import { ChatBubbleLeftRight, Trash } from "@medusajs/icons"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useUpdatePartner, useDeletePartner } from "../../hooks/api/partners-admin"
import { usePersonTypes } from "../../hooks/api/persontype"
import { ActionMenu } from "../common/action-menu"
import { sdk } from "../../lib/config"
import { useQuery, useQueryClient } from "@tanstack/react-query"

export type AdminPartner = {
  id: string
  name: string
  handle: string
  logo?: string | null
  status: "active" | "inactive" | "pending"
  is_verified: boolean
  workspace_type?: "seller" | "manufacturer" | "individual"
  metadata?: Record<string, any> | null
}

export const PartnerGeneralSection = ({ partner }: { partner: AdminPartner }) => {
  const prompt = usePrompt()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(partner.name)
  const [handle, setHandle] = useState(partner.handle)
  const [logo, setLogo] = useState(partner.logo || "")
  const [status, setStatus] = useState<"active" | "inactive" | "pending">(partner.status)
  const [isVerified, setIsVerified] = useState<boolean>(!!partner.is_verified)
  const [workspaceType, setWorkspaceType] = useState<"seller" | "manufacturer" | "individual">(
    partner.workspace_type || "manufacturer"
  )

  const { mutateAsync: updatePartner, isPending } = useUpdatePartner()
  const { mutateAsync: deletePartner } = useDeletePartner(partner.id)

  // Person types for individual workspace type
  const { personTypes: allPersonTypes } = usePersonTypes({ limit: 100 })
  const { data: linkedPersonTypesData } = useQuery({
    queryKey: ["partner-person-types", partner.id],
    queryFn: () =>
      sdk.client.fetch<{ person_types: any[]; count: number }>(
        `/admin/partners/${partner.id}/person-types`
      ),
    enabled: workspaceType === "individual",
  })
  const linkedPersonTypes = linkedPersonTypesData?.person_types || []
  const [selectedPersonTypeIds, setSelectedPersonTypeIds] = useState<string[]>([])
  const [personTypesDirty, setPersonTypesDirty] = useState(false)

  useEffect(() => {
    const ids = linkedPersonTypes.map((pt: any) => pt.id)
    setSelectedPersonTypeIds(ids)
    setPersonTypesDirty(false)
  }, [linkedPersonTypesData])

  const handleDelete = async () => {
    const res = await prompt({
      title: "Delete Partner",
      description: `Are you sure you want to delete "${partner.name}"? This action cannot be undone. All linked data (tasks, designs, orders, feedbacks) will be unlinked.`,
      verificationInstruction: "Type the partner handle to confirm.",
      verificationText: partner.handle,
      confirmText: "Delete",
      cancelText: "Cancel",
    })

    if (!res) return

    try {
      await deletePartner()
      toast.success("Partner deleted", { description: `"${partner.name}" has been removed.` })
      navigate("/partners", { replace: true })
    } catch (e: any) {
      toast.error("Delete failed", { description: e?.message || "Could not delete partner" })
    }
  }

  // Sync local state if the partner prop updates (e.g., after a successful save/refetch)
  useEffect(() => {
    setName(partner.name)
    setHandle(partner.handle)
    setLogo(partner.logo || "")
    setStatus(partner.status)
    setIsVerified(!!partner.is_verified)
    setWorkspaceType(partner.workspace_type || "manufacturer")
  }, [partner.id, partner.name, partner.handle, partner.logo, partner.status, partner.is_verified, partner.workspace_type])

  const isDirty = useMemo(() => {
    const norm = (v: string | null | undefined) => (v || "").trim()
    return (
      norm(name) !== norm(partner.name) ||
      norm(handle) !== norm(partner.handle) ||
      norm(logo) !== norm(partner.logo) ||
      status !== partner.status ||
      Boolean(isVerified) !== Boolean(partner.is_verified) ||
      workspaceType !== (partner.workspace_type || "manufacturer")
    )
  }, [name, handle, logo, status, isVerified, workspaceType, partner.name, partner.handle, partner.logo, partner.status, partner.is_verified, partner.workspace_type])

  const onSave = async () => {
    try {
      await updatePartner({
        id: partner.id,
        data: { name, handle, logo: logo || null, status, is_verified: isVerified, workspace_type: workspaceType },
      })
      toast.success("Partner updated", { description: "Your changes have been saved." })
    } catch (e: any) {
      toast.error("Update failed", { description: e?.message || "Could not update partner" })
    }
  }

  const onSavePersonTypes = async () => {
    try {
      await sdk.client.fetch(`/admin/partners/${partner.id}/person-types`, {
        method: "POST",
        body: { person_type_ids: selectedPersonTypeIds },
      })
      queryClient.invalidateQueries({ queryKey: ["partner-person-types", partner.id] })
      setPersonTypesDirty(false)
      toast.success("Person types updated")
    } catch (e: any) {
      toast.error("Failed to update person types", { description: e?.message })
    }
  }

  const togglePersonType = (id: string) => {
    setSelectedPersonTypeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
    setPersonTypesDirty(true)
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
          {isVerified ? <Badge color="green">Verified</Badge> : <Badge>Verified</Badge>}
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Add Feedback",
                    icon: <ChatBubbleLeftRight />,
                    to: `/partners/${partner.id}/add-feedback`,
                  },
                ],
              },
              {
                actions: [
                  {
                    label: "Delete",
                    icon: <Trash />,
                    onClick: handleDelete,
                  },
                ],
              },
            ]}
          />
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
          <div>
            <Label size="small">Workspace Type</Label>
            <Select value={workspaceType} onValueChange={(v: string) => setWorkspaceType(v as any)}>
              <Select.Trigger>
                <Select.Value placeholder="Select workspace type" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="seller">Seller</Select.Item>
                <Select.Item value="manufacturer">Manufacturer</Select.Item>
                <Select.Item value="individual">Individual</Select.Item>
              </Select.Content>
            </Select>
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="small" onClick={onSave} disabled={!isDirty || isPending} variant={isDirty ? "primary" : "secondary"}>
            Save
          </Button>
        </div>
      </div>

      {workspaceType === "individual" && (
        <div className="px-6 py-4 space-y-3">
          <div>
            <Heading level="h2" className="text-base">Person Types</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Select the roles this individual performs
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            {(allPersonTypes || []).map((pt: any) => {
              const isSelected = selectedPersonTypeIds.includes(pt.id)
              return (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => togglePersonType(pt.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-all ${
                    isSelected
                      ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                      : "border-ui-border-base hover:shadow-elevation-card-hover"
                  }`}
                >
                  {pt.name}
                </button>
              )
            })}
          </div>
          {personTypesDirty && (
            <div className="flex justify-end">
              <Button size="small" onClick={onSavePersonTypes} variant="primary">
                Save Person Types
              </Button>
            </div>
          )}
        </div>
      )}
    </Container>
  )
}
