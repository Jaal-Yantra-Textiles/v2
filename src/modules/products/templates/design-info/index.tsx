import { Badge, Heading, Text } from "@medusajs/ui"
import { CheckCircleSolid, Clock } from "@medusajs/icons"

import { StoreDesign } from "../../../../types/product-design"

type DesignInfoProps = {
  design?: StoreDesign
}

export const DesignInfo = ({ design }: DesignInfoProps) => {
  if (!design) {
    return null
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div className="h-px w-full border-b border-gray-200 my-4" />
      <div id={`design-info-${design.id}`} className="flex flex-col gap-y-4">
        <Heading
          level="h3"
          className="text-2xl leading-10 text-ui-fg-base"
          data-testid="design-title"
        >
          {design.name}
        </Heading>

        <div className="flex items-center gap-x-2 flex-wrap gap-y-2">
          {design.design_type && (
            <Badge color="blue">{design.design_type}</Badge>
          )}
          {design.status && (
            <Badge color="grey">{design.status.replace(/_/g, " ")}</Badge>
          )}
          {design.priority && <Badge color="purple">{design.priority}</Badge>}
          {design.tags?.map((tag: string) => (
            <Badge key={tag} color="green">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-8">
          <Heading level="h3" className="mb-4">
            General
          </Heading>
          {design.description && (
            <Text
              className="text-medium text-ui-fg-subtle whitespace-pre-line"
              data-testid="design-description"
            >
              {design.description}
            </Text>
          )}

          {design.partners && design.partners.length > 0 && (
            <div className="mt-4">
              <Text className="text-small-semi text-ui-fg-base mb-2">
                Produced by
              </Text>
              <Text className="text-small-regular text-ui-fg-subtle">
                {design.partners?.map((p: { name: string }) => p.name).join(", ")}
              </Text>
            </div>
          )}

          {design.color_palette && design.color_palette.length > 0 && (
            <div className="mt-4">
              <Text className="text-small-semi text-ui-fg-base mb-2">
                Color Palette
              </Text>
              <div className="flex items-center gap-x-4 flex-wrap gap-y-2">
                {design.color_palette?.map((color: { name: string; code: string }) => (
                  <div key={color.name} className="flex items-center gap-x-2">
                    <div
                      className="w-6 h-6 rounded-full border border-ui-border-base"
                      style={{ backgroundColor: color.code }}
                    />
                    <Text className="text-small-regular text-ui-fg-subtle">
                      {color.name}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mb-8">
          <Heading level="h3" className="mb-4">
            Activities
          </Heading>
          {design.tasks && design.tasks.length > 0 ? (
            <div className="flex flex-col gap-y-3">
              {design.tasks?.map((task: { id: string; title: string; status: string }) => (
                <div key={task.id} className="flex items-center gap-x-3">
                  <div>
                    {task.status === "completed" ? (
                      <CheckCircleSolid className="text-ui-fg-interactive" />
                    ) : (
                      <Clock className="text-ui-fg-muted" />
                    )}
                  </div>
                  <Text className="text-small-regular text-ui-fg-subtle">
                    <span className="font-semibold text-ui-fg-base">
                      {task.title}:
                    </span>
                    <span className="capitalize ml-1">
                      {task.status.replace(/_/g, " ")}
                    </span>
                  </Text>
                </div>
              ))}
            </div>
          ) : (
            <Text>No activities recorded for this design.</Text>
          )}
        </div>
      </div>
    </div>
  )
}


