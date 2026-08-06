import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  FocusModal,
  Heading,
  Input,
  Label,
  StatusBadge,
  Switch,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"

import { financialYearWindow } from "../../../lib/financial-year"
import {
  AdminExportLut,
  AdminPlatformTaxIdentity,
  useCreateExportLut,
  useDeleteExportLut,
  useExportIgstStatus,
  usePlatformTaxIdentities,
  useUpdateExportLut,
} from "../../../hooks/api/export-luts"

/**
 * Export LUT settings (#1216).
 *
 * An LUT (GST form RFD-11) lets an exporter ship without paying IGST. It covers
 * ONE financial year and must be re-furnished each April — which is the entire
 * reason this screen exists rather than an env var. The banner therefore leads
 * with what a label declares TODAY (read from the resolver, not inferred from the
 * rows on screen) and how long that has left to run, because "a row exists" and
 * "it is still valid" are different facts and the gap between them is a false
 * declaration.
 */

/** Warn this far ahead of expiry — enough time to re-furnish before the FY rolls. */
const EXPIRY_WARNING_DAYS = 45

const fmtDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—"

type LutFormState = {
  arn: string
  financial_year: string
  valid_from: string
  valid_to: string
  filed_on: string
  notes: string
  is_active: boolean
}

const emptyForm: LutFormState = {
  arn: "",
  financial_year: "",
  valid_from: "",
  valid_to: "",
  filed_on: "",
  notes: "",
  is_active: true,
}

const toFormState = (lut: AdminExportLut): LutFormState => ({
  arn: lut.arn ?? "",
  financial_year: lut.financial_year ?? "",
  valid_from: lut.valid_from ? lut.valid_from.slice(0, 10) : "",
  valid_to: lut.valid_to ? lut.valid_to.slice(0, 10) : "",
  filed_on: lut.filed_on ? lut.filed_on.slice(0, 10) : "",
  notes: lut.notes ?? "",
  is_active: lut.is_active ?? true,
})

const LutFields = ({
  value,
  onChange,
  showActive,
}: {
  value: LutFormState
  onChange: (next: LutFormState) => void
  showActive?: boolean
}) => {
  const set = (patch: Partial<LutFormState>) => onChange({ ...value, ...patch })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          ARN
        </Label>
        <Input
          placeholder="AD070426000123A"
          value={value.arn}
          onChange={(e) => set({ arn: e.target.value })}
        />
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          The acknowledgement number the GST portal returns on furnishing RFD-11.
        </Text>
      </div>

      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          Financial year
        </Label>
        <Input
          placeholder="2026-27"
          value={value.financial_year}
          onChange={(e) => {
            const financial_year = e.target.value
            // Prefill the window from the FY, but never overwrite dates already
            // typed — a mid-year LUT starts on its filing date, not 1 April.
            const window = financialYearWindow(financial_year)
            set({
              financial_year,
              ...(window && !value.valid_from && !value.valid_to
                ? { valid_from: window.from, valid_to: window.to }
                : {}),
            })
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label size="small" weight="plus">
            Valid from
          </Label>
          <Input
            type="date"
            value={value.valid_from}
            onChange={(e) => set({ valid_from: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label size="small" weight="plus">
            Valid to
          </Label>
          <Input
            type="date"
            value={value.valid_to}
            onChange={(e) => set({ valid_to: e.target.value })}
          />
        </div>
      </div>
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        After <strong>valid to</strong>, exports automatically go back to declaring
        IGST as paid and reclaimed. Nothing needs switching off.
      </Text>

      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          Filed on <span className="text-ui-fg-muted">(optional)</span>
        </Label>
        <Input
          type="date"
          value={value.filed_on}
          onChange={(e) => set({ filed_on: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label size="small" weight="plus">
          Notes <span className="text-ui-fg-muted">(optional)</span>
        </Label>
        <Textarea
          placeholder="Who furnished it, witnesses, portal reference…"
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </div>

      {showActive ? (
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <Text size="small" leading="compact" weight="plus">
              Active
            </Text>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Turning this off stops exports relying on it immediately, while
              keeping it readable for shipments already declared under it.
            </Text>
          </div>
          <Switch
            checked={value.is_active}
            onCheckedChange={(is_active) => set({ is_active })}
          />
        </div>
      ) : null}
    </div>
  )
}

/** Shared payload builder — omits the optional fields rather than sending "". */
const toPayload = (form: LutFormState, includeActive: boolean) => ({
  arn: form.arn.trim(),
  financial_year: form.financial_year.trim(),
  valid_from: form.valid_from,
  valid_to: form.valid_to,
  ...(form.filed_on ? { filed_on: form.filed_on } : {}),
  ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
  ...(includeActive ? { is_active: form.is_active } : {}),
})

const isComplete = (form: LutFormState) =>
  Boolean(form.arn.trim() && form.financial_year.trim() && form.valid_from && form.valid_to)

const CreateLutModal = ({
  identity,
  open,
  onOpenChange,
}: {
  identity: AdminPlatformTaxIdentity
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const [form, setForm] = useState<LutFormState>(emptyForm)
  const create = useCreateExportLut(identity.id)

  useEffect(() => {
    if (open) setForm(emptyForm)
  }, [open])

  const submit = () => {
    create.mutate(toPayload(form, true), {
      onSuccess: () => {
        toast.success("LUT recorded — exports will declare under it while it is valid")
        onOpenChange(false)
      },
      onError: (e: any) => toast.error(e?.message || "Could not record the LUT"),
    })
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Heading level="h2">Record an export LUT</Heading>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-8">
          <div className="flex w-full max-w-lg flex-col gap-4">
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Furnished by <strong>{identity.legal_name}</strong> ({identity.tax_id}).
              Record one per financial year — renewing adds a new entry rather than
              editing last year's, so past declarations stay auditable.
            </Text>
            <LutFields value={form} onChange={setForm} showActive />
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="small"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button
              size="small"
              onClick={submit}
              isLoading={create.isPending}
              disabled={create.isPending || !isComplete(form)}
            >
              Record LUT
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

const EditLutDrawer = ({
  identityId,
  lut,
  onClose,
}: {
  identityId: string
  lut: AdminExportLut
  onClose: () => void
}) => {
  const [form, setForm] = useState<LutFormState>(() => toFormState(lut))
  const update = useUpdateExportLut(identityId, lut.id)

  useEffect(() => setForm(toFormState(lut)), [lut])

  const submit = () => {
    update.mutate(toPayload(form, true), {
      onSuccess: () => {
        toast.success("LUT updated")
        onClose()
      },
      onError: (e: any) => toast.error(e?.message || "Could not update the LUT"),
    })
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Heading level="h2">Edit LUT</Heading>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto">
          <LutFields value={form} onChange={setForm} showActive />
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="small"
              variant="secondary"
              onClick={onClose}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button
              size="small"
              onClick={submit}
              isLoading={update.isPending}
              disabled={update.isPending || !isComplete(form)}
            >
              Save
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const LutRow = ({
  identityId,
  lut,
  onEdit,
}: {
  identityId: string
  lut: AdminExportLut
  onEdit: () => void
}) => {
  const prompt = usePrompt()
  const remove = useDeleteExportLut(identityId, lut.id)

  const now = Date.now()
  const from = new Date(lut.valid_from).getTime()
  const to = new Date(lut.valid_to).getTime()
  const inForce = lut.is_active && now >= from && now <= to

  const state = !lut.is_active
    ? { color: "grey" as const, label: "Withdrawn" }
    : now > to
      ? { color: "red" as const, label: "Expired" }
      : now < from
        ? { color: "orange" as const, label: "Not yet in force" }
        : { color: "green" as const, label: "In force" }

  const confirmDelete = async () => {
    const ok = await prompt({
      title: "Delete this LUT?",
      description:
        "Prefer switching it to inactive instead — shipments already declared under it should stay auditable. Delete only a row created in error.",
    })
    if (!ok) return
    remove.mutate(undefined, {
      onSuccess: () => toast.success("LUT deleted"),
      onError: (e: any) => toast.error(e?.message || "Could not delete the LUT"),
    })
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-ui-border-base px-6 py-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Text size="small" leading="compact" weight="plus">
            {lut.arn}
          </Text>
          <Badge size="2xsmall">FY {lut.financial_year}</Badge>
          <StatusBadge color={state.color}>{state.label}</StatusBadge>
          {inForce ? <Badge size="2xsmall" color="green">Declaring B</Badge> : null}
        </div>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {fmtDate(lut.valid_from)} → {fmtDate(lut.valid_to)}
          {lut.filed_on ? ` · filed ${fmtDate(lut.filed_on)}` : ""}
        </Text>
        {lut.notes ? (
          <Text size="small" leading="compact" className="text-ui-fg-muted">
            {lut.notes}
          </Text>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button size="small" variant="secondary" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="small"
          variant="danger"
          onClick={confirmDelete}
          isLoading={remove.isPending}
          disabled={remove.isPending}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

const IdentitySection = ({ identity }: { identity: AdminPlatformTaxIdentity }) => {
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<AdminExportLut | null>(null)

  // The identity payload already carries its LUTs, so no second fetch per section.
  const luts = useMemo(
    () =>
      [...(identity.export_luts ?? [])].sort(
        (a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime()
      ),
    [identity.export_luts]
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col">
          <Text size="small" leading="compact" weight="plus">
            {identity.legal_name}
          </Text>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {identity.tax_id_type?.toUpperCase()} {identity.tax_id}
          </Text>
        </div>
        <Button size="small" onClick={() => setCreateOpen(true)}>
          Record LUT
        </Button>
      </div>

      {luts.length ? (
        luts.map((lut) => (
          <LutRow
            key={lut.id}
            identityId={identity.id}
            lut={lut}
            onEdit={() => setEditing(lut)}
          />
        ))
      ) : (
        <div className="px-6 py-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            No LUT recorded. Exports declare IGST as paid and reclaimed until one is
            furnished and entered here.
          </Text>
        </div>
      )}

      <CreateLutModal
        identity={identity}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      {editing ? (
        <EditLutDrawer
          identityId={identity.id}
          lut={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Container>
  )
}

const StatusBanner = () => {
  const { export_igst, isLoading } = useExportIgstStatus()

  if (isLoading) {
    return (
      <Container>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Checking what exports declare today…
        </Text>
      </Container>
    )
  }

  const underLut = export_igst?.declares_under_lut
  const days = export_igst?.days_until_expiry
  const expiringSoon = underLut && typeof days === "number" && days <= EXPIRY_WARNING_DAYS

  return (
    <Container className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Text size="small" leading="compact" weight="plus">
          Exports currently declare
        </Text>
        <StatusBadge color={underLut ? "green" : "orange"}>
          {underLut ? "B — under LUT, no IGST paid" : "C — IGST paid and reclaimed"}
        </StatusBadge>
      </div>

      {underLut ? (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Relying on ARN <strong>{export_igst?.lut_arn}</strong> (FY{" "}
          {export_igst?.financial_year}) — {days} day{days === 1 ? "" : "s"} of cover
          left.
        </Text>
      ) : (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          No LUT is in force, so exports pay IGST and reclaim it. This is the correct
          declaration without one on file — record an LUT below to switch.
        </Text>
      )}

      {expiringSoon ? (
        <Text size="small" leading="compact" className="text-ui-fg-error">
          This LUT lapses in {days} day{days === 1 ? "" : "s"}. Re-furnish RFD-11 for
          the next financial year and record it here; exports revert to “C” on their
          own the moment it expires.
        </Text>
      ) : null}
    </Container>
  )
}

const ExportLutPage = () => {
  const { platform_tax_identities, isLoading } = usePlatformTaxIdentities()

  // Mirror the resolver: it only considers LUTs on an ACTIVE identity registered
  // for India. Showing rows the resolver would ignore (the Latvian VAT entity —
  // an LUT is a GST instrument) would imply cover that doesn't exist.
  const indianIdentities = useMemo(
    () =>
      (platform_tax_identities ?? []).filter(
        (i) =>
          i.is_active !== false &&
          (i.country_codes ?? []).some((c) => String(c).toUpperCase() === "IN")
      ),
    [platform_tax_identities]
  )

  return (
    <div className="flex flex-col gap-3">
      <Container className="flex flex-col gap-1">
        <Heading level="h1">Export LUT</Heading>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          A Letter of Undertaking (GST form RFD-11) lets exports ship without paying
          IGST. It covers one financial year and must be re-furnished each April —
          recorded here so the declaration expires by itself instead of silently
          claiming cover that has lapsed.
        </Text>
      </Container>

      <StatusBanner />

      {isLoading ? (
        <Container>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Loading tax identities…
          </Text>
        </Container>
      ) : indianIdentities.length ? (
        indianIdentities.map((identity) => (
          <IdentitySection key={identity.id} identity={identity} />
        ))
      ) : (
        <Container>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            No active India-registered tax identity found, so there is nothing an LUT
            could attach to.
          </Text>
        </Container>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Export LUT",
  icon: DocumentText,
})

export default ExportLutPage
