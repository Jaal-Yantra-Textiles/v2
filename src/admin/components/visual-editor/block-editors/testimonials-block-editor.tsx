import { Input, Textarea, Button } from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { BlockEditorProps } from "./index"

interface Testimonial {
  quote: string
  name: string
  subtitle: string
  company: string
  image_url: string
}

export function TestimonialsBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const title = (content.title as string) || ""
  const testimonials = (content.testimonials as Testimonial[]) || []
  const callToAction = content.callToAction as {
    text?: string
    linkText?: string
    linkUrl?: string
  } | undefined

  const updateField = (field: string, value: unknown) => {
    onContentChange({ ...content, [field]: value })
  }

  const updateTestimonial = (index: number, updates: Partial<Testimonial>) => {
    const newTestimonials = [...testimonials]
    newTestimonials[index] = { ...newTestimonials[index], ...updates }
    updateField("testimonials", newTestimonials)
  }

  const addTestimonial = () => {
    updateField("testimonials", [
      ...testimonials,
      {
        quote: "Amazing product!",
        name: "John Doe",
        subtitle: "CEO",
        company: "Company Name",
        image_url: "",
      },
    ])
  }

  const removeTestimonial = (index: number) => {
    const newTestimonials = testimonials.filter((_, i) => i !== index)
    updateField("testimonials", newTestimonials)
  }

  const updateCTA = (updates: Partial<typeof callToAction>) => {
    updateField("callToAction", { ...callToAction, ...updates })
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Section Title</label>
        <Input
          value={title}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="Enter section title"
        />
      </div>

      {/* Testimonials */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Testimonials ({testimonials.length})</label>
        <div className="space-y-3">
          {testimonials.map((testimonial, index) => (
            <div key={index} className="p-3 border rounded-lg bg-ui-bg-subtle">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Textarea
                    value={testimonial.quote}
                    onChange={(e) => updateTestimonial(index, { quote: e.target.value })}
                    placeholder="Testimonial quote"
                    rows={3}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={testimonial.name}
                      onChange={(e) => updateTestimonial(index, { name: e.target.value })}
                      placeholder="Name"
                      size="small"
                    />
                    <Input
                      value={testimonial.subtitle}
                      onChange={(e) => updateTestimonial(index, { subtitle: e.target.value })}
                      placeholder="Title/Role"
                      size="small"
                    />
                  </div>
                  <Input
                    value={testimonial.company}
                    onChange={(e) => updateTestimonial(index, { company: e.target.value })}
                    placeholder="Company"
                    size="small"
                  />
                  <Input
                    value={testimonial.image_url}
                    onChange={(e) => updateTestimonial(index, { image_url: e.target.value })}
                    placeholder="Avatar image URL"
                    size="small"
                  />
                </div>
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => removeTestimonial(index)}
                  className="text-ui-fg-error"
                >
                  <Trash className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="secondary" size="small" onClick={addTestimonial} className="w-full">
            <Plus className="w-4 h-4 mr-1" />
            Add Testimonial
          </Button>
        </div>
      </div>

      {/* Call to Action */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Call to Action (optional)</label>
        <div className="space-y-2 p-3 border rounded-lg bg-ui-bg-subtle">
          <Input
            value={callToAction?.text || ""}
            onChange={(e) => updateCTA({ text: e.target.value })}
            placeholder="CTA text"
            size="small"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={callToAction?.linkText || ""}
              onChange={(e) => updateCTA({ linkText: e.target.value })}
              placeholder="Link text"
              size="small"
            />
            <Input
              value={callToAction?.linkUrl || ""}
              onChange={(e) => updateCTA({ linkUrl: e.target.value })}
              placeholder="Link URL"
              size="small"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
