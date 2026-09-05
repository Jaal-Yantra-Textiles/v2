import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import {
  Button,
  Heading,
  Input,
  Select,
  Skeleton,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { KeyboundForm } from "../../../components/utilitites/key-bound-form"
import { useRouteModal } from "../../../components/modal/use-route-modal"
import { Form } from "../../../components/common/form"
import {
  useTextileAnalysis,
  useUpdateTextileAnalysis,
} from "../../../hooks/api/textile-analyses"
import { getThumbUrl, isImageUrl } from "../../../lib/media"

const SOURCE_OPTIONS = [
  { value: "internal_extraction", label: "Internal extraction" },
  { value: "storefront_reference", label: "Storefront reference" },
  { value: "partner_upload", label: "Partner upload" },
  { value: "manual", label: "Manual" },
] as const

const schema = z.object({
  title: z.string(),
  description: z.string(),
  source: z.enum(["internal_extraction", "storefront_reference", "partner_upload", "manual"]),
  cloth_type: z.string(),
  category: z.string(),
  pattern: z.string(),
  fabric_weight: z.string(),
  weave_or_knit: z.string(),
  primary_color: z.string(),
  confidence: z.string(),
  colors: z.string(),
  season: z.string(),
  occasion: z.string(),
  care_instructions: z.string(),
  target_audience: z.string(),
})

type FormValues = z.infer<typeof schema>

const toText = (s: string): string | null => (s.trim() ? s.trim() : null)

const toList = (s: string): string[] | null => {
  const list = s.split(",").map((x) => x.trim()).filter(Boolean)
  return list.length ? list : null
}

const DEFAULT_VALUES: FormValues = {
  title: "",
  description: "",
  source: "internal_extraction",
  cloth_type: "",
  category: "",
  pattern: "",
  fabric_weight: "",
  weave_or_knit: "",
  primary_color: "",
  confidence: "",
  colors: "",
  season: "",
  occasion: "",
  care_instructions: "",
  target_audience: "",
}

const EditTextileAnalysisComponent = () => {
  const { id } = useParams()
  const { data, isLoading } = useTextileAnalysis(id)
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateTextileAnalysis()

  const form = useForm<FormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!data) return
    form.reset({
      title: data.title ?? "",
      description: data.description ?? "",
      source: (data.source as FormValues["source"]) ?? "internal_extraction",
      cloth_type: data.cloth_type ?? "",
      category: data.category ?? "",
      pattern: data.pattern ?? "",
      fabric_weight: data.fabric_weight ?? "",
      weave_or_knit: data.weave_or_knit ?? "",
      primary_color: data.primary_color ?? "",
      confidence:
        typeof data.confidence === "number" ? String(data.confidence) : "",
      colors: (data.colors ?? []).join(", "),
      season: (data.season ?? []).join(", "),
      occasion: (data.occasion ?? []).join(", "),
      care_instructions: (data.care_instructions ?? []).join(", "),
      target_audience: data.target_audience ?? "",
    })
  }, [data, form])

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutateAsync({
        id: id!,
        title: toText(values.title),
        description: toText(values.description),
        source: values.source,
        cloth_type: toText(values.cloth_type),
        category: toText(values.category),
        pattern: toText(values.pattern),
        fabric_weight: toText(values.fabric_weight),
        weave_or_knit: toText(values.weave_or_knit),
        primary_color: toText(values.primary_color),
        confidence: values.confidence.trim() ? Number(values.confidence) : null,
        colors: toList(values.colors),
        season: toList(values.season),
        occasion: toList(values.occasion),
        care_instructions: toList(values.care_instructions),
        target_audience: toText(values.target_audience),
      })
      toast.success("Textile analysis updated")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update")
    }
  })

  const image = data?.media?.file_path

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-8 md:px-6 md:py-10">
          <div className="flex w-full max-w-[720px] flex-col gap-y-6">
            {isLoading ? (
              <div className="flex flex-col gap-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : !data ? (
              <Text>This analysis could not be found.</Text>
            ) : (
              <>
                <div className="flex items-start gap-4">
                  {image && isImageUrl(image) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={getThumbUrl(image, { width: 384, quality: 75, fit: "cover" })}
                      alt={data.title ?? data.media?.file_name ?? ""}
                      className="size-24 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="bg-ui-bg-base-pressed flex size-24 shrink-0 items-center justify-center rounded-lg">
                      <Text size="xsmall" className="text-ui-fg-muted">
                        no image
                      </Text>
                    </div>
                  )}
                  <div>
                    <Heading className="text-xl md:text-2xl">Edit textile analysis</Heading>
                    <Text size="small" className="text-ui-fg-subtle mt-1">
                      Correct what the vision model saw in this fabric.
                    </Text>
                  </div>
                </div>

                <div>
                  <Heading level="h2" className="text-lg">Identification</Heading>
                  <div className="mt-3 grid grid-cols-1 gap-4">
                    <Form.Field
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>Title</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Description</Form.Label>
                          <Form.Control>
                            <Textarea rows={3} {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="target_audience"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Target audience</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>

                <div>
                  <Heading level="h2" className="text-lg">Classification</Heading>
                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="source"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>Source</Form.Label>
                          <Form.Control>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <Select.Trigger>
                                <Select.Value />
                              </Select.Trigger>
                              <Select.Content>
                                {SOURCE_OPTIONS.map((o) => (
                                  <Select.Item key={o.value} value={o.value}>
                                    {o.label}
                                  </Select.Item>
                                ))}
                              </Select.Content>
                            </Select>
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="confidence"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Confidence (0–1)</Form.Label>
                          <Form.Control>
                            <Input
                              autoComplete="off"
                              type="number"
                              step="0.01"
                              min="0"
                              max="1"
                              {...field}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="cloth_type"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Garment</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="top, saree, trousers…" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Category</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="tops, bottoms, outerwear…" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="pattern"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Pattern</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="floral, stripe, solid…" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="fabric_weight"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Weight</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="light-weight, medium-weight…" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="weave_or_knit"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Construction</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="woven, knit" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="primary_color"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Primary colour</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="red, beige…" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>

                <div>
                  <Heading level="h2" className="text-lg">Lists</Heading>
                  <Text size="small" className="text-ui-fg-subtle mt-1">
                    Comma-separated.
                  </Text>
                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="colors"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Colours</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="red, indigo, gold" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="season"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Season</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="summer, monsoon" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="occasion"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Occasion</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="festive, everyday" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="care_instructions"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label optional>Care instructions</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" placeholder="dry clean, hand wash" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer className="px-4 py-3 md:px-6 md:py-4">
          <div className="flex w-full flex-col-reverse items-center justify-end gap-2 sm:flex-row">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary" className="w-full sm:w-auto">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
              disabled={isLoading || !data}
              className="w-full sm:w-auto"
            >
              Save
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

const EditTextileAnalysisModal = () => {
  return (
    <RouteFocusModal>
      <EditTextileAnalysisComponent />
    </RouteFocusModal>
  )
}

export default EditTextileAnalysisModal