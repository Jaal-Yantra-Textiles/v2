"use client"

import { useMemo, useState } from "react"
import { Badge, Button, Container, Heading, Input, Label, Text, Tooltip } from "@medusajs/ui"
import Image from "next/image"
import { updatePartnerBranding, updatePartnerGeneral, updatePartnerStatusVerification } from "../../actions"

export type PartnerDetails = {
  id: string
  name: string
  handle: string
  logo: string | null
  status: "active" | "inactive" | "pending"
  is_verified: boolean
  metadata?: Record<string, unknown> | null
}

export function ProfileSettingsClient({ initial, canEditStatus = false }: { initial: PartnerDetails | null; canEditStatus?: boolean }) {
  const [partner, setPartner] = useState<PartnerDetails | null>(initial)
  const [generalName, setGeneralName] = useState(initial?.name || "")
  const [generalHandle, setGeneralHandle] = useState(initial?.handle || "")
  const [brandingLogo, setBrandingLogo] = useState(initial?.logo || "")
  const [error, setError] = useState<string | null>(null)
  const [status] = useState<"active" | "inactive" | "pending">(initial?.status || "pending")
  const [isVerified] = useState<boolean>(Boolean(initial?.is_verified))

  const generalDirty = useMemo(() => {
    if (!partner) return false
    return partner.name !== generalName || partner.handle !== generalHandle
  }, [partner, generalName, generalHandle])

  const brandingDirty = useMemo(() => {
    if (!partner) return false
    const current = partner.logo || ""
    return current !== brandingLogo
  }, [partner, brandingLogo])

  // Helper mapping for badge color + tooltip text
  const statusInfo = useMemo(() => {
    switch (status) {
      case "active":
        return { color: "green" as const, label: "Active", tip: "This partner is active and can access all partner features." }
      case "inactive":
        return { color: "grey" as const, label: "Inactive", tip: "This partner is inactive and may have limited or no access." }
      case "pending":
      default:
        return { color: "orange" as const, label: "Pending", tip: "This partner is pending verification/approval." }
    }
  }, [status])

  return (
    <div className="flex flex-col gap-y-6">
      {error && (
        <Container className="border-red-500/30">
          <Text className="text-red-600">{error}</Text>
        </Container>
      )}

      {/* General Section */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <Heading level="h2">General</Heading>
            <Text className="text-ui-fg-subtle">Basic details about your organization.</Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Button
              size="small"
              variant="secondary"
              disabled={!generalDirty}
              onClick={() => {
                if (!partner) return
                setGeneralName(partner.name || "")
                setGeneralHandle(partner.handle || "")
              }}
            >
              Reset
            </Button>
            <form
              action={async (formData: FormData) => {
                try {
                  await updatePartnerGeneral(formData)
                  // Optimistically update local state
                  if (partner) setPartner({ ...partner, name: generalName, handle: generalHandle })
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "Failed to save"
                  setError(msg)
                }
              }}
            >
              <input type="hidden" name="name" value={generalName} />
              <input type="hidden" name="handle" value={generalHandle} />
              <Button size="small" disabled={!generalDirty} type="submit">
                Save
              </Button>
            </form>
          </div>
        </div>
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={generalName} onChange={(e) => setGeneralName(e.target.value)} placeholder="Acme Textiles" />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="handle">Handle</Label>
            <Input id="handle" value={generalHandle} onChange={(e) => setGeneralHandle(e.target.value)} placeholder="acme" />
          </div>
        </div>
      </Container>

      {/* Branding Section */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <Heading level="h2">Branding</Heading>
            <Text className="text-ui-fg-subtle">Logo and visual identity.</Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Button
              size="small"
              variant="secondary"
              disabled={!brandingDirty}
              onClick={() => {
                if (!partner) return
                setBrandingLogo(partner.logo || "")
              }}
            >
              Reset
            </Button>
            <form
              action={async (formData: FormData) => {
                try {
                  await updatePartnerBranding(formData)
                  if (partner) setPartner({ ...partner, logo: brandingLogo || null })
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "Failed to save"
                  setError(msg)
                }
              }}
            >
              <input type="hidden" name="logo" value={brandingLogo} />
              <Button size="small" disabled={!brandingDirty} type="submit">
                Save
              </Button>
            </form>
          </div>
        </div>
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="logo">Logo URL</Label>
            <Input id="logo" value={brandingLogo} onChange={(e) => setBrandingLogo(e.target.value)} placeholder="https://.../logo.png" />
            {brandingLogo ? (
              <div className="mt-2">
                <Image src={brandingLogo} alt="Logo preview" width={64} height={64} className="rounded bg-ui-bg-subtle object-contain" />
              </div>
            ) : null}
          </div>
        </div>
      </Container>

      {/* Status & Verification Section */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <Heading level="h2">Status & Verification</Heading>
            <Text className="text-ui-fg-subtle">Current partner status and verification.</Text>
          </div>
        </div>
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-2">
            <Label>Status</Label>
            <div className="flex items-center gap-2">
              <Tooltip content={statusInfo.tip} side="top">
                <Badge color={statusInfo.color}>{statusInfo.label}</Badge>
              </Tooltip>
            </div>
          </div>
          <div className="flex flex-col gap-y-2">
            <Label>Verified</Label>
            <Text>{isVerified ? "Yes" : "No"}</Text>
          </div>
        </div>

        {/* Optional: Editing controls behind permission guard (disabled by default) */}
        {canEditStatus && (
          <div className="px-6 py-4 border-t flex items-center justify-end gap-2">
            <form
              action={async (formData: FormData) => {
                try {
                  // In a real guarded flow you would collect edited values via inputs
                  formData.set("status", status)
                  formData.set("is_verified", String(isVerified))
                  await updatePartnerStatusVerification(formData)
                  if (partner) setPartner({ ...partner, status, is_verified: isVerified })
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "Failed to save"
                  setError(msg)
                }
              }}
            >
              <Button size="small" variant="secondary" disabled>
                Reset
              </Button>
              <Button size="small" type="submit" disabled>
                Save
              </Button>
            </form>
          </div>
        )}
      </Container>
    </div>
  )
}
