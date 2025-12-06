import { z } from "zod"
import { toast } from "@medusajs/ui"
import { DynamicForm, type FieldConfig } from "../common/dynamic-form"
import { useRouteModal } from "../modal/use-route-modal"
import { useUpdateCampaign, Campaign, ContentRule } from "../../hooks/api/publishing-campaigns"

const campaignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  interval_hours: z.number().min(1, "Interval must be at least 1 hour"),
  hashtag_strategy: z.enum(["from_product", "from_design", "custom", "none"]),
  image_selection: z.enum(["thumbnail", "first", "all", "featured"]),
})

type CampaignFormData = z.infer<typeof campaignSchema>

const hashtagStrategyOptions = [
  { value: "from_product", label: "From Product Tags" },
  { value: "from_design", label: "From Linked Design" },
  { value: "custom", label: "Custom Hashtags" },
  { value: "none", label: "No Hashtags" },
]

const imageSelectionOptions = [
  { value: "all", label: "All Images (carousel)" },
  { value: "thumbnail", label: "Thumbnail Only" },
  { value: "first", label: "First Image" },
  { value: "featured", label: "Featured/Thumbnail" },
]

type EditCampaignFormProps = {
  campaign: Campaign
}

export const EditCampaignForm = ({ campaign }: EditCampaignFormProps) => {
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateCampaign()

  const canEdit = ["draft", "paused"].includes(campaign.status)

  const handleSubmit = async (data: CampaignFormData) => {
    if (!canEdit) {
      toast.error("Can only edit draft or paused campaigns")
      return
    }

    const updatedContentRule: ContentRule = {
      ...campaign.content_rule,
      hashtag_strategy: data.hashtag_strategy,
      image_selection: data.image_selection,
    }

    await mutateAsync(
      {
        id: campaign.id,
        name: data.name,
        interval_hours: data.interval_hours,
        content_rule: updatedContentRule,
      },
      {
        onSuccess: () => {
          toast.success("Campaign updated successfully")
          handleSuccess()
        },
        onError: (error) => {
          toast.error(error.message || "Failed to update campaign")
        },
      }
    )
  }

  const fields: FieldConfig<CampaignFormData>[] = [
    {
      name: "name",
      type: "text",
      label: "Campaign Name",
      required: true,
    },
    {
      name: "interval_hours",
      type: "number",
      label: "Interval (hours)",
      hint: "Time between each post",
      required: true,
    },
    {
      name: "hashtag_strategy",
      type: "select",
      label: "Hashtag Strategy",
      options: hashtagStrategyOptions,
    },
    {
      name: "image_selection",
      type: "select",
      label: "Image Selection",
      options: imageSelectionOptions,
    },
  ]

  return (
    <>
      {!canEdit && (
        <div className="mx-4 mt-4 p-3 bg-ui-bg-subtle rounded-lg">
          <p className="text-sm text-ui-fg-subtle">
            Only draft or paused campaigns can be edited.
          </p>
        </div>
      )}
      <DynamicForm
        fields={fields}
        defaultValues={{
          name: campaign.name,
          interval_hours: campaign.interval_hours,
          hashtag_strategy: campaign.content_rule?.hashtag_strategy || "from_product",
          image_selection: campaign.content_rule?.image_selection || "all",
        }}
        onSubmit={handleSubmit}
        isPending={isPending}
        layout={{ showDrawer: true, gridCols: 1 }}
      />
    </>
  )
}
