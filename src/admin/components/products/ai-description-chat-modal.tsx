import { Button, FocusModal, Textarea, Text, Heading, Badge, Switch } from "@medusajs/ui"
import { useState } from "react"
import { useGenerateProductDescription } from "../../hooks/api/products"
import { toast } from "sonner"
import { Spinner } from "../ui/spinner"
import { Sparkles, ArrowPath, InformationCircle, InformationCircleSolid } from "@medusajs/icons"

type Design = {
  id: string
  name: string
  description?: string
  design_type?: string
  status?: string
  color_palette?: Array<{
    name: string
    value: string
    is_primary?: boolean
  }>
  tags?: string[]
  designer_notes?: any
  metadata?: Record<string, any>
}

interface AIDescriptionChatModalProps {
  productId: string
  selectedImageUrl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (title: string, description: string) => void
  designs: Design[]
}

const AIDescriptionChatModal = ({
  productId,
  selectedImageUrl,
  open,
  onOpenChange,
  onApply,
  designs,
}: AIDescriptionChatModalProps) => {
  const [hint, setHint] = useState("")
  const [generatedTitle, setGeneratedTitle] = useState("")
  const [generatedDescription, setGeneratedDescription] = useState("")
  const [hasGenerated, setHasGenerated] = useState(false)
  const [includeDesignInfo, setIncludeDesignInfo] = useState(designs.length > 0)

  const generateMutation = useGenerateProductDescription()

  const handleGenerate = async () => {
    if (!selectedImageUrl) {
      toast.error("Please select an image first")
      return
    }

    // Prepare design context if enabled
    let designContext = undefined
    if (includeDesignInfo && designs.length > 0) {
      const design = designs[0] // Use first design
      designContext = {
        name: design.name,
        description: design.description,
        design_type: design.design_type,
        status: design.status,
        color_palette: design.color_palette?.map(c => `${c.name} (${c.value})`).join(", "),
        tags: design.tags?.join(", "),
        metadata: design.metadata,
      }
    }

    try {
      const result = await generateMutation.mutateAsync({
        productId,
        payload: {
          imageUrl: selectedImageUrl,
          hint: hint || undefined,
          notes: designContext ? `Design Context: ${JSON.stringify(designContext, null, 2)}` : undefined,
        },
      })

      setGeneratedTitle(result.title)
      setGeneratedDescription(result.description)
      setHasGenerated(true)
      toast.success("Description generated successfully!")
    } catch (error) {
      toast.error("Failed to generate description")
      console.error(error)
    }
  }

  const handleApply = () => {
    if (generatedTitle && generatedDescription) {
      onApply(generatedTitle, generatedDescription)
      handleClose()
    }
  }

  const handleClose = () => {
    setHint("")
    setGeneratedTitle("")
    setGeneratedDescription("")
    setHasGenerated(false)
    onOpenChange(false)
  }

  return (
    <FocusModal open={open} onOpenChange={handleClose}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center gap-x-2">
            <Sparkles className="text-ui-fg-interactive" />
            <FocusModal.Title>AI Product Description Generator</FocusModal.Title>
          </div>
          <FocusModal.Description>
            Generate compelling product descriptions from images using AI
          </FocusModal.Description>
        </FocusModal.Header>
        <FocusModal.Body className="overflow-y-auto flex items-start justify-center">
          <div className="flex flex-col gap-y-6 w-full max-w-3xl mx-auto py-4">
            {/* Selected Image Preview */}
            {selectedImageUrl && (
              <div className="flex flex-col gap-y-3">
                <div className="flex items-center gap-x-2">
                  <Text size="small" weight="plus" className="text-ui-fg-base">
                    Selected Image
                  </Text>
                  <Badge size="2xsmall" color="blue">
                    AI Ready
                  </Badge>
                </div>
                <div className="relative h-48 w-48 overflow-hidden rounded-lg border-2 border-ui-border-strong shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedImageUrl}
                    alt="Selected product"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            )}

            {/* Design Info Toggle */}
            {!hasGenerated && designs.length > 0 && (
              <div className="flex flex-col gap-y-3 p-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-x-2">
                    <InformationCircle className="text-ui-fg-interactive" />
                    <div className="flex flex-col gap-y-1">
                      <Text size="small" weight="plus" className="text-ui-fg-base">
                        Include Design Information
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        Use linked design details to enhance the description
                      </Text>
                    </div>
                  </div>
                  <Switch
                    checked={includeDesignInfo}
                    onCheckedChange={setIncludeDesignInfo}
                  />
                </div>
                {includeDesignInfo && (
                  <div className="flex flex-col gap-y-2 pt-2 border-t border-ui-border-base">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-base">
                      Design: {designs[0].name}
                    </Text>
                    <div className="flex flex-wrap gap-1">
                      {designs[0].tags?.slice(0, 5).map((tag, idx) => (
                        <Badge key={idx} size="2xsmall" color="grey">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Chat Input */}
            {!hasGenerated && (
              <div className="flex flex-col gap-y-3">
                <div className="flex flex-col gap-y-1">
                  <Text size="small" weight="plus" className="text-ui-fg-base">
                    Add Context (Optional)
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Help the AI understand what to emphasize in the description
                  </Text>
                </div>
                <Textarea
                  placeholder="E.g., Focus on eco-friendly materials, emphasize comfort and style, mention the artisan craftsmanship..."
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  rows={5}
                  className="resize-none"
                />
              </div>
            )}

            {/* Generated Results */}
            {hasGenerated && (
              <div className="flex flex-col gap-y-6">
                <div className="flex flex-col gap-y-3">
                  <div className="flex items-center justify-between">
                    <Text size="small" weight="plus" className="text-ui-fg-base">
                      Generated Title
                    </Text>
                    <Badge size="2xsmall" color="green">
                      <Sparkles className="mr-1" />
                      AI Generated
                    </Badge>
                  </div>
                  <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4 shadow-sm">
                    <Heading level="h3" className="text-ui-fg-base">
                      {generatedTitle}
                    </Heading>
                  </div>
                </div>

                <div className="flex flex-col gap-y-3">
                  <Text size="small" weight="plus" className="text-ui-fg-base">
                    Generated Description
                  </Text>
                  <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4 shadow-sm max-h-64 overflow-y-auto">
                    <Text className="whitespace-pre-wrap leading-relaxed text-ui-fg-base">
                      {generatedDescription}
                    </Text>
                  </div>
                </div>

                <div className="flex items-center gap-x-2 pt-2 border-t border-ui-border-base">
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => setHasGenerated(false)}
                  >
                    <ArrowPath className="mr-2" />
                    Regenerate
                  </Button>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Try with a different hint or context
                  </Text>
                </div>
              </div>
            )}
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-x-2">
              {!hasGenerated && (
                <Text size="xsmall" className="text-ui-fg-muted">
                  Powered by AI vision analysis
                </Text>
              )}
            </div>
            <div className="flex items-center gap-x-2">
              <FocusModal.Close asChild>
                <Button variant="secondary" onClick={handleClose}>
                  Cancel
                </Button>
              </FocusModal.Close>
              {!hasGenerated ? (
                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  disabled={!selectedImageUrl || generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <span className="flex items-center gap-x-2">
                      <Spinner  size="small"/>
                      Generating...
                    </span>
                  ) : (
                    <>
                      <Sparkles className="mr-2" />
                      Generate Description
                    </>
                  )}
                </Button>
              ) : (
                <Button variant="primary" onClick={handleApply}>
                  Apply to Product
                </Button>
              )}
            </div>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default AIDescriptionChatModal
