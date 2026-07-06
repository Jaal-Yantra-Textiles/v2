import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  Input,
  Label,
  Select,
  Textarea,
  FocusModal,
  toast,
} from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { useState } from "react"
import {
  AdminDesign,
  ConstructionDetail,
  ConstructionDetailPayload,
  useConstructionDetails,
  useCreateConstructionDetail,
  useDeleteConstructionDetail,
} from "../../hooks/api/designs"

// Keep in sync with SUPPORTED_TECHNIQUES on the backend route / DETAIL_RENDERERS.
// `paramHint` documents the parameter the renderer reads, shown as a placeholder.
const TECHNIQUES: { value: string; label: string; paramHint: string }[] = [
  { value: "dart", label: "Dart", paramHint: "intake = 0.6" },
  { value: "knife-pleat", label: "Knife pleat", paramHint: "count = 5" },
  { value: "box-pleat", label: "Box pleat", paramHint: "count = 3" },
  { value: "gathers", label: "Gathers", paramHint: "ratio = 1.6" },
  { value: "tucks", label: "Tucks", paramHint: "count = 4" },
  { value: "topstitch", label: "Topstitch", paramHint: "rows = 2" },
  { value: "yoke", label: "Yoke", paramHint: "drop = 0.4" },
  { value: "embroidery", label: "Embroidery", paramHint: "motif = 6" },
]

// Ready-made construction details for common garment features. Selecting one
// pre-fills the form so the same detail isn't re-authored from scratch each time.
// All techniques below must exist in TECHNIQUES / the backend SUPPORTED_TECHNIQUES.
type ConstructionSample = {
  value: string
  label: string
  technique: string
  detailLabel: string
  params?: Record<string, number>
  fabricRules?: string[]
  note?: string
}

const SAMPLES: ConstructionSample[] = [
  {
    value: "waist-dart",
    label: "Waist dart",
    technique: "dart",
    detailLabel: "Waist dart",
    params: { intake: 0.6 },
    fabricRules: ["press toward centre front", "taper to nothing at apex"],
    note: "Backstitch at waist seam, leave apex un-backstitched",
  },
  {
    value: "bust-dart",
    label: "Bust dart",
    technique: "dart",
    detailLabel: "Bust dart",
    params: { intake: 0.5 },
    fabricRules: ["press downward", "end 2.5 cm short of apex"],
  },
  {
    value: "knife-pleat-skirt",
    label: "Knife pleats (skirt)",
    technique: "knife-pleat",
    detailLabel: "Knife pleats",
    params: { count: 6 },
    fabricRules: ["all pleats face one direction", "press sharp, edge-stitch top 8 cm"],
  },
  {
    value: "box-pleat-center",
    label: "Centre box pleat",
    technique: "box-pleat",
    detailLabel: "Centre box pleat",
    params: { count: 1 },
    fabricRules: ["centre on CF", "tack at waist"],
  },
  {
    value: "gathered-sleeve-head",
    label: "Gathered sleeve head",
    technique: "gathers",
    detailLabel: "Sleeve-head gathers",
    params: { ratio: 1.4 },
    fabricRules: ["two rows of ease stitching", "distribute fullness between notches"],
  },
  {
    value: "gathered-skirt-waist",
    label: "Gathered skirt waist",
    technique: "gathers",
    detailLabel: "Waist gathers",
    params: { ratio: 2 },
    fabricRules: ["gather evenly to waistband length"],
  },
  {
    value: "pin-tucks-bodice",
    label: "Pin tucks (bodice)",
    technique: "tucks",
    detailLabel: "Pin tucks",
    params: { count: 5 },
    fabricRules: ["6 mm spacing", "press to one side"],
  },
  {
    value: "double-topstitch-hem",
    label: "Double topstitch hem",
    technique: "topstitch",
    detailLabel: "Double topstitch",
    params: { rows: 2 },
    fabricRules: ["6 mm row spacing", "matching thread"],
  },
  {
    value: "edge-topstitch",
    label: "Edge topstitch",
    technique: "topstitch",
    detailLabel: "Edge topstitch",
    params: { rows: 1 },
    fabricRules: ["1.5 mm from edge"],
  },
  {
    value: "back-yoke",
    label: "Back yoke",
    technique: "yoke",
    detailLabel: "Back yoke",
    params: { drop: 0.4 },
    fabricRules: ["burrito method", "understitch yoke seam"],
  },
  {
    value: "chain-embroidery",
    label: "Chain-stitch embroidery",
    technique: "embroidery",
    detailLabel: "Chain-stitch motif",
    params: { motif: 6 },
    fabricRules: ["stabilise reverse before stitching"],
  },
]

/** Parse a textarea of `key = value` lines into a numeric param map (non-numeric dropped). */
function parseParams(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split("\n")) {
    const m = line.split("=")
    if (m.length !== 2) continue
    const key = m[0].trim()
    const val = Number(m[1].trim())
    if (key && Number.isFinite(val)) out[key] = val
  }
  return out
}

/** Parse a textarea into a trimmed, non-empty list (one rule per line). */
function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

const DetailRow = ({
  item,
  designId,
}: {
  item: ConstructionDetail
  designId: string
}) => {
  const { mutateAsync: remove, isPending } = useDeleteConstructionDetail(designId)
  const technique = item.metadata?.technique
  const params = item.metadata?.params
  const rules = item.metadata?.fabricRules

  const handleRemove = async () => {
    try {
      await remove(item.id)
      toast.success("Construction detail removed")
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove detail")
    }
  }

  return (
    <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-ui-fg-base font-medium truncate">{item.title}</span>
            {technique ? (
              <Badge size="2xsmall" color="blue">{technique}</Badge>
            ) : (
              <Badge size="2xsmall" color="orange">no technique</Badge>
            )}
          </div>
          {params && Object.keys(params).length > 0 && (
            <Text size="xsmall" className="text-ui-fg-subtle mt-0.5 truncate">
              {Object.entries(params).map(([k, v]) => `${k} ${v}`).join(" · ")}
            </Text>
          )}
          {rules && rules.length > 0 && (
            <Text size="xsmall" className="text-ui-fg-muted mt-0.5 truncate">
              {rules.join(" · ")}
            </Text>
          )}
        </div>
        <Button
          size="small"
          variant="transparent"
          isLoading={isPending}
          onClick={handleRemove}
        >
          <Trash className="text-ui-fg-subtle" />
        </Button>
      </div>
    </div>
  )
}

const AddDetailModal = ({ designId }: { designId: string }) => {
  const [open, setOpen] = useState(false)
  const [technique, setTechnique] = useState<string>("")
  const [label, setLabel] = useState("")
  const [paramsText, setParamsText] = useState("")
  const [rulesText, setRulesText] = useState("")
  const [note, setNote] = useState("")

  const [sample, setSample] = useState<string>("")

  const { mutateAsync: create, isPending } = useCreateConstructionDetail(designId)

  const reset = () => {
    setSample("")
    setTechnique("")
    setLabel("")
    setParamsText("")
    setRulesText("")
    setNote("")
  }

  const applySample = (value: string) => {
    setSample(value)
    const s = SAMPLES.find((x) => x.value === value)
    if (!s) return
    setTechnique(s.technique)
    setLabel(s.detailLabel)
    setParamsText(
      s.params
        ? Object.entries(s.params).map(([k, v]) => `${k} = ${v}`).join("\n")
        : ""
    )
    setRulesText((s.fabricRules ?? []).join("\n"))
    setNote(s.note ?? "")
  }

  const handleSubmit = async () => {
    if (!technique) {
      toast.error("Pick a technique")
      return
    }
    const payload: ConstructionDetailPayload = { technique }
    if (label.trim()) payload.label = label.trim()
    const params = parseParams(paramsText)
    if (Object.keys(params).length) payload.params = params
    const rules = parseLines(rulesText)
    if (rules.length) payload.fabricRules = rules
    if (note.trim()) payload.note = note.trim()

    try {
      await create(payload)
      toast.success("Construction detail added")
      reset()
      setOpen(false)
    } catch (e: any) {
      toast.error(e?.message || "Failed to add detail")
    }
  }

  const paramHint =
    TECHNIQUES.find((t) => t.value === technique)?.paramHint ?? "intake = 0.6"

  return (
    <FocusModal open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">
          <Plus className="mr-1" />Add detail
        </Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <div className="flex h-full flex-col overflow-hidden">
          <FocusModal.Header>
            <div className="flex items-center justify-end gap-x-2">
              <FocusModal.Close asChild>
                <Button size="small" variant="secondary">Cancel</Button>
              </FocusModal.Close>
              <Button size="small" onClick={handleSubmit} isLoading={isPending}>
                Add
              </Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex-1 overflow-auto">
            <div className="mx-auto flex w-full max-w-lg flex-col gap-y-4 py-8">
              <div>
                <Heading level="h2">Add construction detail</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Feeds the tech-pack's construction-details frame.
                </Text>
              </div>

              <div className="flex flex-col gap-y-2">
                <Label>Start from a sample <span className="text-ui-fg-muted">(optional)</span></Label>
                <Select value={sample} onValueChange={applySample}>
                  <Select.Trigger>
                    <Select.Value placeholder="Pick a common detail to pre-fill" />
                  </Select.Trigger>
                  <Select.Content>
                    {SAMPLES.map((s) => (
                      <Select.Item key={s.value} value={s.value}>
                        {s.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Fills the fields below — tweak anything before adding.
                </Text>
              </div>

              <div className="flex flex-col gap-y-2">
                <Label>Technique</Label>
                <Select value={technique} onValueChange={setTechnique}>
                  <Select.Trigger>
                    <Select.Value placeholder="Select a technique" />
                  </Select.Trigger>
                  <Select.Content>
                    {TECHNIQUES.map((t) => (
                      <Select.Item key={t.value} value={t.value}>
                        {t.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <div className="flex flex-col gap-y-2">
                <Label>Label <span className="text-ui-fg-muted">(optional)</span></Label>
                <Input
                  placeholder="e.g. Waist dart"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-y-2">
                <Label>Parameters <span className="text-ui-fg-muted">(one per line, key = number)</span></Label>
                <Textarea
                  rows={3}
                  placeholder={paramHint}
                  value={paramsText}
                  onChange={(e) => setParamsText(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-y-2">
                <Label>Fabric / sewing rules <span className="text-ui-fg-muted">(one per line)</span></Label>
                <Textarea
                  rows={3}
                  placeholder={"press toward CF\nclip at apex"}
                  value={rulesText}
                  onChange={(e) => setRulesText(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-y-2">
                <Label>Note <span className="text-ui-fg-muted">(optional)</span></Label>
                <Input
                  placeholder="e.g. 6 mm from edge"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          </FocusModal.Body>
        </div>
      </FocusModal.Content>
    </FocusModal>
  )
}

interface DesignConstructionSectionProps {
  design: AdminDesign
}

export const DesignConstructionSection = ({
  design,
}: DesignConstructionSectionProps) => {
  const { construction_details, isLoading } = useConstructionDetails(design.id)

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Construction details</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Techniques the tech-pack generator renders
          </Text>
        </div>
        <AddDetailModal designId={design.id} />
      </div>

      <div className="txt-small flex flex-col gap-2 px-3 pb-3">
        {isLoading ? (
          <div className="py-4 text-center">
            <Text className="text-ui-fg-subtle">Loading...</Text>
          </div>
        ) : construction_details.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-4 gap-1">
            <Text className="text-ui-fg-subtle">No construction details yet</Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              Add at least one so a tech-pack can be generated
            </Text>
          </div>
        ) : (
          construction_details.map((item) => (
            <DetailRow key={item.id} item={item} designId={design.id} />
          ))
        )}
      </div>
    </Container>
  )
}
