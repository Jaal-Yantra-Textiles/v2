import { useEffect, useState } from "react"
import { XMark } from "@medusajs/icons"
import { Button, Container, Heading, Input, Label, Text, toast } from "@medusajs/ui"

import {
  CorrectionEntry,
  SocialMediaEntry,
  useUpdateWeaverProperty,
  useWeaverProperty,
} from "../../hooks/api/person-properties"

/**
 * Admin "edit / changes" surface for a census weaver.
 *
 * Persists to the person_property record keyed by census_id (MikroHyperbee KV,
 * append-only) — NOT the read-only census core. Three editable bags:
 * social media, correction flags ("this census value is wrong"), and arbitrary
 * custom fields.
 */
export const WeaverEditsSection = ({ censusId }: { censusId: string | number }) => {
  const { data, isLoading } = useWeaverProperty(censusId)
  const update = useUpdateWeaverProperty(censusId)

  const prop = data?.person_property

  const [socialMedia, setSocialMedia] = useState<SocialMediaEntry[]>([])
  const [corrections, setCorrections] = useState<CorrectionEntry[]>([])
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({})

  // Seed the drafts once the record loads (or is created). Keyed on the record
  // id so a refetch after save does not clobber in-flight local edits.
  useEffect(() => {
    setSocialMedia(prop?.social_media ?? [])
    setCorrections(prop?.corrections ?? [])
    setCustomFields(prop?.custom_fields ?? {})
  }, [prop?.id])

  // ── social media draft ────────────────────────────────────────────────────
  const [smPlatform, setSmPlatform] = useState("")
  const [smHandle, setSmHandle] = useState("")
  const [smUrl, setSmUrl] = useState("")
  const addSocial = () => {
    if (!smPlatform.trim()) return
    setSocialMedia((prev) => [
      ...prev,
      { platform: smPlatform.trim(), handle: smHandle.trim() || undefined, url: smUrl.trim() || undefined },
    ])
    setSmPlatform(""); setSmHandle(""); setSmUrl("")
  }

  // ── correction draft ──────────────────────────────────────────────────────
  const [corrField, setCorrField] = useState("")
  const [corrNote, setCorrNote] = useState("")
  const [corrValue, setCorrValue] = useState("")
  const addCorrection = () => {
    if (!corrField.trim()) return
    setCorrections((prev) => [
      ...prev,
      {
        field: corrField.trim(),
        note: corrNote.trim() || undefined,
        corrected_value: corrValue.trim() === "" ? undefined : corrValue.trim(),
        corrected_at: new Date().toISOString(),
      },
    ])
    setCorrField(""); setCorrNote(""); setCorrValue("")
  }

  // ── custom field draft ────────────────────────────────────────────────────
  const [cfKey, setCfKey] = useState("")
  const [cfValue, setCfValue] = useState("")
  const addCustomField = () => {
    if (!cfKey.trim()) return
    setCustomFields((prev) => ({ ...prev, [cfKey.trim()]: cfValue.trim() }))
    setCfKey(""); setCfValue("")
  }

  const save = async () => {
    try {
      await update.mutateAsync({
        social_media: socialMedia,
        corrections,
        custom_fields: customFields,
      })
      toast.success("Weaver edits saved")
    } catch (e: any) {
      toast.error(e?.message || "Failed to save edits")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col px-6 py-4">
        <Heading level="h2">Edits &amp; changes</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Your additions to this census record — stored with the census data, not the database
        </Text>
      </div>

      {/* Social media */}
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <Text size="small" weight="plus">Social media</Text>
        {socialMedia.map((e, i) => (
          <div key={i} className="flex items-center gap-x-2 text-sm">
            <span className="font-medium">{e.platform}</span>
            <span className="text-ui-fg-subtle">{e.handle || e.url || ""}</span>
            <button
              type="button"
              className="text-ui-fg-muted hover:text-ui-fg-subtle"
              onClick={() => setSocialMedia((prev) => prev.filter((_, j) => j !== i))}
            >
              <XMark />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-x-2">
          <Input placeholder="Platform" value={smPlatform} onChange={(e) => setSmPlatform(e.target.value)} />
          <Input placeholder="Handle" value={smHandle} onChange={(e) => setSmHandle(e.target.value)} />
          <Input placeholder="URL" value={smUrl} onChange={(e) => setSmUrl(e.target.value)} />
          <Button size="small" variant="secondary" type="button" onClick={addSocial}>Add</Button>
        </div>
      </div>

      {/* Corrections */}
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <Text size="small" weight="plus">Incorrect values</Text>
        {corrections.map((c, i) => (
          <div key={i} className="flex items-center gap-x-2 text-sm">
            <span className="font-medium">{c.field}</span>
            {c.corrected_value !== undefined ? (
              <span className="text-ui-fg-subtle">→ {String(c.corrected_value)}</span>
            ) : null}
            {c.note ? <span className="text-ui-fg-subtle">({c.note})</span> : null}
            <button
              type="button"
              className="text-ui-fg-muted hover:text-ui-fg-subtle"
              onClick={() => setCorrections((prev) => prev.filter((_, j) => j !== i))}
            >
              <XMark />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-x-2">
          <Input placeholder="Field" value={corrField} onChange={(e) => setCorrField(e.target.value)} />
          <Input placeholder="Corrected value" value={corrValue} onChange={(e) => setCorrValue(e.target.value)} />
          <Input placeholder="Note" value={corrNote} onChange={(e) => setCorrNote(e.target.value)} />
          <Button size="small" variant="secondary" type="button" onClick={addCorrection}>Add</Button>
        </div>
      </div>

      {/* Custom fields */}
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <Text size="small" weight="plus">Custom fields</Text>
        {Object.entries(customFields).map(([k, v]) => (
          <div key={k} className="flex items-center gap-x-2 text-sm">
            <span className="font-medium">{k}</span>
            <span className="text-ui-fg-subtle">{String(v)}</span>
            <button
              type="button"
              className="text-ui-fg-muted hover:text-ui-fg-subtle"
              onClick={() =>
                setCustomFields((prev) => {
                  const next = { ...prev }
                  delete next[k]
                  return next
                })
              }
            >
              <XMark />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2">
          <Input placeholder="Key" value={cfKey} onChange={(e) => setCfKey(e.target.value)} />
          <Input placeholder="Value" value={cfValue} onChange={(e) => setCfValue(e.target.value)} />
          <Button size="small" variant="secondary" type="button" onClick={addCustomField}>Add</Button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-x-2 px-6 py-4">
        {isLoading ? <Text size="small" className="text-ui-fg-subtle">Loading…</Text> : null}
        <Button
          size="small"
          variant="primary"
          type="button"
          onClick={save}
          isLoading={update.isPending}
        >
          Save changes
        </Button>
      </div>
    </Container>
  )
}