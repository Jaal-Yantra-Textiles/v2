import { Button, Heading, Input, Text, Textarea, toast } from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { FormProvider, useFieldArray, useForm } from "react-hook-form"
import { z } from "@medusajs/framework/zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouteModal } from "../modal/use-route-modal"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { Form } from "../common/form"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { AdminForm, useUpdateForm } from "../../hooks/api/forms"
import { TourSegmentEditor } from "./tour-segment-editor"

const segmentLinkSchema = z.object({
  label: z.string().optional(),
  url: z.string().optional(),
})

const segmentImageSchema = z.object({
  url: z.string().optional(),
})

const segmentSchema = z.object({
  id: z.string().min(1, "id required"),
  title: z.string().min(1, "title required"),
  description: z.string().optional(),
  image_url: z.string().optional(),
  duration_minutes: z.number().int().nonnegative().optional(),
  time_slot: z.string().optional(),
  base_price: z.number().nonnegative().default(0),
  currency: z.string().optional(),
  required: z.boolean().default(false),
  links: z.array(segmentLinkSchema).default([]),
  gallery: z.array(segmentImageSchema).default([]),
})

const multiplierSchema = z.object({
  category: z.string().min(1),
  multiplier: z.number().nonnegative().default(1),
})

const guideSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "name required"),
  role: z.string().optional(),
  bio: z.string().optional(),
  photo_url: z.string().optional(),
  languages: z.string().optional(),
  instagram: z.string().optional(),
})

const tourSettingsSchema = z.object({
  currency: z.string().min(1, "currency required"),
  story_headline: z.string().optional(),
  story_body: z.string().optional(),
  segments: z.array(segmentSchema),
  multipliers: z.array(multiplierSchema),
  guides: z.array(guideSchema),
})

type TourSettingsFormData = z.input<typeof tourSettingsSchema>

const buildDefaults = (form: AdminForm): TourSettingsFormData => {
  const settings = (form.settings as Record<string, any> | null) || {}
  const segments = Array.isArray(settings.itinerary_segments)
    ? (settings.itinerary_segments as any[])
    : []
  const pricing = (settings.pricing as Record<string, any>) || {}
  const multiplierObj = (pricing.per_category_multiplier as Record<string, number>) || {}
  const story = (settings.story as Record<string, any>) || {}
  const guides = Array.isArray(settings.guides) ? (settings.guides as any[]) : []

  return {
    currency: pricing.currency || segments[0]?.currency || "INR",
    story_headline: story.headline ?? "",
    story_body: story.body ?? "",
    segments: segments.map((s) => ({
      id: s.id ?? "",
      title: s.title ?? "",
      description: s.description ?? "",
      image_url: s.image_url ?? "",
      duration_minutes: typeof s.duration_minutes === "number" ? s.duration_minutes : undefined,
      time_slot: s.time_slot ?? "",
      base_price: typeof s.base_price === "number" ? s.base_price : 0,
      currency: s.currency ?? "",
      required: !!s.required,
      links: Array.isArray(s.links)
        ? s.links.map((l: any) => ({ label: l?.label ?? "", url: l?.url ?? "" }))
        : [],
      gallery: Array.isArray(s.gallery)
        ? s.gallery
            .map((g: any) => ({ url: typeof g === "string" ? g : g?.url ?? "" }))
            .filter((g: any) => g.url)
        : [],
    })),
    multipliers: Object.entries(multiplierObj).map(([category, multiplier]) => ({
      category,
      multiplier: typeof multiplier === "number" ? multiplier : 1,
    })),
    guides: guides.map((g) => ({
      id: g.id ?? "",
      name: g.name ?? "",
      role: g.role ?? "",
      bio: g.bio ?? "",
      photo_url: g.photo_url ?? "",
      languages: Array.isArray(g.languages) ? g.languages.join(", ") : g.languages ?? "",
      instagram: g.instagram ?? "",
    })),
  }
}

type EditTourSettingsProps = { form: AdminForm }

export const EditTourSettingsComponent = ({ form }: EditTourSettingsProps) => {
  const formCtx = useForm<TourSettingsFormData>({
    defaultValues: buildDefaults(form),
    resolver: zodResolver(tourSettingsSchema),
  })

  const segments = useFieldArray({ control: formCtx.control, name: "segments" })
  const multipliers = useFieldArray({ control: formCtx.control, name: "multipliers" })
  const guides = useFieldArray({ control: formCtx.control, name: "guides" })

  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateForm(form.id)

  const handleSubmit = formCtx.handleSubmit(async (data) => {
    const existingSettings = (form.settings as Record<string, any> | null) || {}

    const cleanedSegments = data.segments.map((s) => ({
      id: s.id.trim(),
      title: s.title.trim(),
      description: s.description?.trim() || null,
      image_url: s.image_url?.trim() || null,
      duration_minutes:
        typeof s.duration_minutes === "number" && s.duration_minutes > 0
          ? s.duration_minutes
          : null,
      time_slot: s.time_slot?.trim() || null,
      base_price: typeof s.base_price === "number" ? s.base_price : 0,
      currency: s.currency?.trim() || data.currency,
      required: !!s.required,
      links: (s.links || [])
        .map((l) => ({
          label: l.label?.trim() || "",
          url: l.url?.trim() || "",
        }))
        .filter((l) => l.url),
      gallery: (s.gallery || [])
        .map((g) => g.url?.trim() || "")
        .filter(Boolean),
    }))

    const multiplierMap: Record<string, number> = {}
    for (const m of data.multipliers) {
      const key = m.category.trim()
      if (!key) continue
      multiplierMap[key] = typeof m.multiplier === "number" ? m.multiplier : 1
    }

    const cleanedGuides = data.guides
      .filter((g) => g.name?.trim())
      .map((g, idx) => ({
        id: g.id?.trim() || `guide_${idx + 1}`,
        name: g.name.trim(),
        role: g.role?.trim() || null,
        bio: g.bio?.trim() || null,
        photo_url: g.photo_url?.trim() || null,
        languages: g.languages
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        instagram: g.instagram?.trim() || null,
      }))

    const headline = data.story_headline?.trim() || null
    const body = data.story_body?.trim() || null
    const story = headline || body ? { headline, body } : null

    const nextSettings = {
      ...existingSettings,
      story,
      guides: cleanedGuides,
      itinerary_segments: cleanedSegments,
      pricing: {
        ...(existingSettings.pricing || {}),
        currency: data.currency,
        per_category_multiplier: multiplierMap,
      },
    }

    try {
      await mutateAsync({ settings: nextSettings })
      toast.success("Tour settings saved")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to save tour settings")
    }
  })

  return (
    <RouteFocusModal.Form form={formCtx}>
      <FormProvider {...formCtx}>
        <KeyboundForm onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
          <RouteFocusModal.Header>
            <div className="flex items-center justify-end gap-x-2">
              <RouteFocusModal.Close asChild>
                <Button size="small" variant="secondary">Cancel</Button>
              </RouteFocusModal.Close>
              <Button size="small" variant="primary" type="submit" isLoading={isPending}>
                Save
              </Button>
            </div>
          </RouteFocusModal.Header>
          <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-10">
            <div className="flex w-full max-w-[920px] flex-col gap-y-10">
              <div>
                <Heading>Tour settings</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Itinerary cards, guides, and pricing rules used by the tour
                  visit page on the website.
                </Text>
              </div>

              {/* Story */}
              <div className="flex flex-col gap-y-3">
                <div>
                  <Text weight="plus">About this tour</Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    Shown on the welcome step. Helps the visitor understand why
                    we&apos;re doing this and the artisans they&apos;re supporting.
                  </Text>
                </div>
                <Form.Field
                  control={formCtx.control}
                  name="story_headline"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Headline</Form.Label>
                      <Form.Control>
                        <Input
                          autoComplete="off"
                          placeholder="A craft journey, told in your own pace."
                          {...field}
                        />
                      </Form.Control>
                    </Form.Item>
                  )}
                />
                <Form.Field
                  control={formCtx.control}
                  name="story_body"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Body</Form.Label>
                      <Form.Control>
                        <Textarea rows={4} {...field} />
                      </Form.Control>
                    </Form.Item>
                  )}
                />
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Form.Field
                  control={formCtx.control}
                  name="currency"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Default currency</Form.Label>
                      <Form.Control>
                        <Input autoComplete="off" placeholder="INR" {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>

              {/* Segments */}
              <div className="flex flex-col gap-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Text weight="plus">Itinerary segments</Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      Each segment becomes a clickable card. Add links and
                      gallery photos for the &quot;more&quot; expand.
                    </Text>
                  </div>
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    onClick={() =>
                      segments.append({
                        id: "",
                        title: "",
                        description: "",
                        image_url: "",
                        duration_minutes: undefined,
                        time_slot: "",
                        base_price: 0,
                        currency: "",
                        required: false,
                        links: [],
                        gallery: [],
                      })
                    }
                  >
                    <Plus /> Add segment
                  </Button>
                </div>

                {segments.fields.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center">
                    <Text size="small" className="text-ui-fg-subtle">
                      No segments yet. Add one to get started.
                    </Text>
                  </div>
                ) : (
                  <div className="flex flex-col gap-y-3">
                    {segments.fields.map((field, index) => (
                      <TourSegmentEditor
                        key={field.id}
                        index={index}
                        onRemove={() => segments.remove(index)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Guides */}
              <div className="flex flex-col gap-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Text weight="plus">Guides &amp; artisans</Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      The people the visitor will meet — shown on the
                      &quot;Meet your guides&quot; step.
                    </Text>
                  </div>
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    onClick={() =>
                      guides.append({
                        id: "",
                        name: "",
                        role: "",
                        bio: "",
                        photo_url: "",
                        languages: "",
                        instagram: "",
                      })
                    }
                  >
                    <Plus /> Add guide
                  </Button>
                </div>

                {guides.fields.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center">
                    <Text size="small" className="text-ui-fg-subtle">
                      No guides yet. Add the artisan(s) leading this tour.
                    </Text>
                  </div>
                ) : (
                  <div className="flex flex-col gap-y-3">
                    {guides.fields.map((field, index) => (
                      <div key={field.id} className="rounded-md border bg-ui-bg-subtle p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <Text size="small" weight="plus">Guide {index + 1}</Text>
                          <Button
                            type="button"
                            size="small"
                            variant="transparent"
                            onClick={() => guides.remove(index)}
                          >
                            <Trash />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <Form.Field
                            control={formCtx.control}
                            name={`guides.${index}.name` as const}
                            render={({ field }) => (
                              <Form.Item>
                                <Form.Label>Name</Form.Label>
                                <Form.Control>
                                  <Input autoComplete="off" {...field} />
                                </Form.Control>
                                <Form.ErrorMessage />
                              </Form.Item>
                            )}
                          />
                          <Form.Field
                            control={formCtx.control}
                            name={`guides.${index}.role` as const}
                            render={({ field }) => (
                              <Form.Item>
                                <Form.Label optional>Role</Form.Label>
                                <Form.Control>
                                  <Input autoComplete="off" placeholder="Master weaver" {...field} />
                                </Form.Control>
                              </Form.Item>
                            )}
                          />
                          <Form.Field
                            control={formCtx.control}
                            name={`guides.${index}.bio` as const}
                            render={({ field }) => (
                              <Form.Item className="md:col-span-2">
                                <Form.Label optional>Bio</Form.Label>
                                <Form.Control>
                                  <Textarea rows={3} {...field} />
                                </Form.Control>
                              </Form.Item>
                            )}
                          />
                          <Form.Field
                            control={formCtx.control}
                            name={`guides.${index}.photo_url` as const}
                            render={({ field }) => (
                              <Form.Item className="md:col-span-2">
                                <Form.Label optional>Photo URL</Form.Label>
                                <Form.Control>
                                  <Input autoComplete="off" placeholder="https://…" {...field} />
                                </Form.Control>
                              </Form.Item>
                            )}
                          />
                          <Form.Field
                            control={formCtx.control}
                            name={`guides.${index}.languages` as const}
                            render={({ field }) => (
                              <Form.Item>
                                <Form.Label optional>Languages</Form.Label>
                                <Form.Control>
                                  <Input autoComplete="off" placeholder="English, Hindi, Italian" {...field} />
                                </Form.Control>
                              </Form.Item>
                            )}
                          />
                          <Form.Field
                            control={formCtx.control}
                            name={`guides.${index}.instagram` as const}
                            render={({ field }) => (
                              <Form.Item>
                                <Form.Label optional>Instagram</Form.Label>
                                <Form.Control>
                                  <Input autoComplete="off" placeholder="@handle" {...field} />
                                </Form.Control>
                              </Form.Item>
                            )}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Multipliers */}
              <div className="flex flex-col gap-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Text weight="plus">Per-category multipliers</Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      Optional: scale segment price per traveller category, e.g.
                      Adult=1, Child=0.5. Categories must match GYG headcount column names.
                    </Text>
                  </div>
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    onClick={() => multipliers.append({ category: "", multiplier: 1 })}
                  >
                    <Plus /> Add row
                  </Button>
                </div>

                {multipliers.fields.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center">
                    <Text size="small" className="text-ui-fg-subtle">
                      No multipliers — every category will count as 1×.
                    </Text>
                  </div>
                ) : (
                  <div className="flex flex-col gap-y-2">
                    {multipliers.fields.map((field, index) => (
                      <div
                        key={field.id}
                        className="grid grid-cols-[1fr_180px_auto] items-end gap-3 rounded-md border bg-ui-bg-subtle p-3"
                      >
                        <Form.Field
                          control={formCtx.control}
                          name={`multipliers.${index}.category` as const}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Category</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" placeholder="Adult" {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        <Form.Field
                          control={formCtx.control}
                          name={`multipliers.${index}.multiplier` as const}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Multiplier</Form.Label>
                              <Form.Control>
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  {...field}
                                  value={field.value ?? 1}
                                  onChange={(e) => field.onChange(Number(e.target.value))}
                                />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        <Button
                          type="button"
                          size="small"
                          variant="transparent"
                          onClick={() => multipliers.remove(index)}
                        >
                          <Trash />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </RouteFocusModal.Body>
        </KeyboundForm>
      </FormProvider>
    </RouteFocusModal.Form>
  )
}
