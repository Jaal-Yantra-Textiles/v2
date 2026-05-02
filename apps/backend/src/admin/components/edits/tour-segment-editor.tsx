import { Button, Input, Switch, Text, Textarea } from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { useFieldArray, useFormContext } from "react-hook-form"
import { Form } from "../common/form"

type Props = {
  index: number
  onRemove: () => void
}

export const TourSegmentEditor = ({ index, onRemove }: Props) => {
  const formCtx = useFormContext<any>()

  const links = useFieldArray({
    control: formCtx.control,
    name: `segments.${index}.links`,
  })

  const gallery = useFieldArray({
    control: formCtx.control,
    name: `segments.${index}.gallery`,
  })

  return (
    <div className="rounded-md border bg-ui-bg-subtle p-4">
      <div className="mb-3 flex items-center justify-between">
        <Text size="small" weight="plus">Segment {index + 1}</Text>
        <Button type="button" size="small" variant="transparent" onClick={onRemove}>
          <Trash />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Form.Field
          control={formCtx.control}
          name={`segments.${index}.id` as const}
          render={({ field }) => (
            <Form.Item>
              <Form.Label>ID (slug)</Form.Label>
              <Form.Control>
                <Input autoComplete="off" placeholder="seg_factory_tour" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={formCtx.control}
          name={`segments.${index}.title` as const}
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
          control={formCtx.control}
          name={`segments.${index}.description` as const}
          render={({ field }) => (
            <Form.Item className="md:col-span-2">
              <Form.Label optional>Description</Form.Label>
              <Form.Control>
                <Textarea rows={2} {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={formCtx.control}
          name={`segments.${index}.image_url` as const}
          render={({ field }) => (
            <Form.Item className="md:col-span-2">
              <Form.Label optional>Cover image URL</Form.Label>
              <Form.Control>
                <Input autoComplete="off" placeholder="https://…" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={formCtx.control}
          name={`segments.${index}.duration_minutes` as const}
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Duration (min)</Form.Label>
              <Form.Control>
                <Input
                  type="number"
                  min={0}
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                  }
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={formCtx.control}
          name={`segments.${index}.time_slot` as const}
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Time slot</Form.Label>
              <Form.Control>
                <Input autoComplete="off" placeholder="11:00" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={formCtx.control}
          name={`segments.${index}.base_price` as const}
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Base price (per pax)</Form.Label>
              <Form.Control>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  {...field}
                  value={field.value ?? 0}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={formCtx.control}
          name={`segments.${index}.currency` as const}
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Currency override</Form.Label>
              <Form.Control>
                <Input autoComplete="off" placeholder="(uses default)" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={formCtx.control}
          name={`segments.${index}.required` as const}
          render={({ field: { value, onChange } }) => (
            <Form.Item className="flex items-center gap-3 pt-6 md:col-span-2">
              <Form.Control>
                <Switch checked={!!value} onCheckedChange={onChange} />
              </Form.Control>
              <Form.Label className="!mt-0">
                Required (always included, can&apos;t toggle off)
              </Form.Label>
            </Form.Item>
          )}
        />
      </div>

      <div className="mt-4 flex flex-col gap-y-2">
        <div className="flex items-center justify-between">
          <Text size="small" weight="plus">Links</Text>
          <Button
            type="button"
            size="small"
            variant="secondary"
            onClick={() => links.append({ label: "", url: "" })}
          >
            <Plus /> Add link
          </Button>
        </div>
        {links.fields.length === 0 ? (
          <Text size="xsmall" className="text-ui-fg-subtle">
            Optional. Shown when the customer expands this segment.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {links.fields.map((row, linkIdx) => (
              <div key={row.id} className="grid grid-cols-[1fr_2fr_auto] items-end gap-2">
                <Form.Field
                  control={formCtx.control}
                  name={`segments.${index}.links.${linkIdx}.label` as const}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Label</Form.Label>
                      <Form.Control>
                        <Input autoComplete="off" placeholder="Watch the video" {...field} />
                      </Form.Control>
                    </Form.Item>
                  )}
                />
                <Form.Field
                  control={formCtx.control}
                  name={`segments.${index}.links.${linkIdx}.url` as const}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>URL</Form.Label>
                      <Form.Control>
                        <Input autoComplete="off" placeholder="https://…" {...field} />
                      </Form.Control>
                    </Form.Item>
                  )}
                />
                <Button
                  type="button"
                  size="small"
                  variant="transparent"
                  onClick={() => links.remove(linkIdx)}
                >
                  <Trash />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-y-2">
        <div className="flex items-center justify-between">
          <Text size="small" weight="plus">Gallery</Text>
          <Button
            type="button"
            size="small"
            variant="secondary"
            onClick={() => gallery.append({ url: "" })}
          >
            <Plus /> Add image
          </Button>
        </div>
        {gallery.fields.length === 0 ? (
          <Text size="xsmall" className="text-ui-fg-subtle">
            Optional extra photos shown alongside the cover image.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {gallery.fields.map((row, gIdx) => (
              <div key={row.id} className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Form.Field
                  control={formCtx.control}
                  name={`segments.${index}.gallery.${gIdx}.url` as const}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Image URL</Form.Label>
                      <Form.Control>
                        <Input autoComplete="off" placeholder="https://…" {...field} />
                      </Form.Control>
                    </Form.Item>
                  )}
                />
                <Button
                  type="button"
                  size="small"
                  variant="transparent"
                  onClick={() => gallery.remove(gIdx)}
                >
                  <Trash />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
