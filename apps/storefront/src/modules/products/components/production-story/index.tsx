import { Badge, Heading, Text } from "@medusajs/ui"
import { CheckCircleSolid, Clock } from "@medusajs/icons"

import { getProductionStory } from "@lib/data/designs"
import type {
  ProductionStoryRun,
  StoryMaterial,
} from "@lib/data/designs"
import {
  humanizeStatus,
  isStoryEmpty,
  nonZeroConsumptionMetrics,
  pickFirstMediaUrl,
  formatStoryDate,
} from "./lib"

type ProductionStoryProps = {
  designId: string
}

/**
 * "How this was made" — money-free production story for a design.
 *
 * Async server component: fetches the public production story for `designId`
 * and renders production runs (status + activity timeline), a sustainability
 * summary (non-zero energy/labor only), the people + partners who made it, and
 * the raw materials used. Renders NOTHING when the story is empty so products
 * without production data are unaffected (mirrors EMPTY_PRODUCTION_STORY).
 *
 * Styling mirrors DesignInfo — Medusa UI components + `--ui-*` tokens only, no
 * hardcoded colors, so dark mode follows for free. No money anywhere (the API
 * omits cost fields by design).
 */
export default async function ProductionStory({ designId }: ProductionStoryProps) {
  const story = await getProductionStory(designId)

  if (isStoryEmpty(story)) {
    return null
  }

  const metrics = nonZeroConsumptionMetrics(story)
  const peopleNames = story.people
    .map((p) => p.name?.trim())
    .filter((n): n is string => !!n)
  const partnerNames = story.partners
    .map((p) => p.name?.trim())
    .filter((n): n is string => !!n)

  return (
    <section
      className="flex flex-col gap-y-6 border-t border-ui-border-base pt-8"
      data-testid="production-story"
    >
      <header className="flex flex-col gap-y-1">
        <Text size="small" className="uppercase tracking-wide text-ui-fg-muted">
          Behind the piece
        </Text>
        <Heading level="h3" className="text-xl leading-8 text-ui-fg-base">
          How this was made
        </Heading>
      </header>

      {story.runs.length > 0 && (
        <div className="flex flex-col gap-y-4">
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Production runs
          </Text>
          <div className="flex flex-col gap-y-4">
            {story.runs.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        </div>
      )}

      {metrics.length > 0 && (
        <section className="space-y-2">
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Resources used
          </Text>
          <div className="flex flex-wrap gap-2">
            {metrics.map((m) => (
              <Badge key={m.label} color="green">
                <span className="font-semibold">{m.label}:</span> {m.value}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {peopleNames.length > 0 && (
        <section className="space-y-2">
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Made by
          </Text>
          <div className="flex flex-col gap-y-1">
            {story.people.map((person) => (
              <Text key={person.id} className="text-small-regular text-ui-fg-subtle">
                {person.name}
                {person.role ? (
                  <span className="text-ui-fg-muted">
                    {" "}
                    · {humanizeStatus(person.role)}
                  </span>
                ) : null}
              </Text>
            ))}
          </div>
        </section>
      )}

      {partnerNames.length > 0 && (
        <section className="space-y-1">
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Crafted with
          </Text>
          <Text className="text-small-regular text-ui-fg-subtle">
            {partnerNames.join(", ")}
          </Text>
        </section>
      )}

      {story.materials.length > 0 && (
        <section className="space-y-3">
          <Text className="text-small-semi text-ui-fg-base uppercase tracking-wide">
            Materials
          </Text>
          <div className="flex flex-col gap-y-3">
            {story.materials.map((material) => (
              <MaterialRow key={material.id} material={material} />
            ))}
          </div>
        </section>
      )}
    </section>
  )
}

function RunCard({ run }: { run: ProductionStoryRun }) {
  const statusLabel = humanizeStatus(run.status)
  const typeLabel = humanizeStatus(run.run_type)
  const date =
    formatStoryDate(run.completed_at) ??
    formatStoryDate(run.finished_at) ??
    formatStoryDate(run.started_at) ??
    formatStoryDate(run.created_at)

  const counts: string[] = []
  if (typeof run.produced_quantity === "number" && typeof run.quantity === "number") {
    counts.push(`${run.produced_quantity}/${run.quantity} made`)
  } else if (typeof run.produced_quantity === "number") {
    counts.push(`${run.produced_quantity} made`)
  } else if (typeof run.quantity === "number") {
    counts.push(`${run.quantity} planned`)
  }
  if (typeof run.rejected_quantity === "number" && run.rejected_quantity > 0) {
    counts.push(`${run.rejected_quantity} rejected`)
  }

  return (
    <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4 shadow-elevation-card-rest">
      <div className="flex flex-wrap items-center gap-2">
        {statusLabel && <Badge color="blue">{statusLabel}</Badge>}
        {typeLabel && <Badge color="grey">{typeLabel}</Badge>}
        {date && (
          <Text className="text-small text-ui-fg-muted ml-auto">{date}</Text>
        )}
      </div>

      {counts.length > 0 && (
        <Text className="mt-2 text-small-regular text-ui-fg-subtle">
          {counts.join(" · ")}
        </Text>
      )}

      {run.activity.length > 0 && (
        <ol className="mt-3 space-y-2">
          {run.activity.map((activity) => {
            const activityDate = formatStoryDate(activity.created_at)
            const isDone = activity.kind === "completed" || activity.kind === "done"
            return (
              <li key={activity.id} className="flex items-start gap-x-2">
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircleSolid className="text-ui-fg-interactive" />
                  ) : (
                    <Clock className="text-ui-fg-muted" />
                  )}
                </div>
                <div className="flex flex-col">
                  <Text className="text-small-regular text-ui-fg-base">
                    {activity.summary || humanizeStatus(activity.activity_type)}
                  </Text>
                  {activityDate && (
                    <Text className="text-small text-ui-fg-muted">
                      {activityDate}
                    </Text>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function MaterialRow({ material }: { material: StoryMaterial }) {
  const imageUrl = pickFirstMediaUrl(material.media)
  const details = [
    material.composition,
    material.color,
    material.material_type ? humanizeStatus(material.material_type) : null,
  ]
    .map((d) => d?.trim())
    .filter((d): d is string => !!d)

  return (
    <div className="flex items-center gap-x-3">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- raw-material media urls are arbitrary external hosts; avoid next/image domain config.
        <img
          src={imageUrl}
          alt={material.name || "Material"}
          loading="lazy"
          className="h-12 w-12 shrink-0 rounded-md border border-ui-border-base object-cover bg-ui-bg-subtle"
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-md border border-ui-border-base bg-ui-bg-subtle" />
      )}
      <div className="flex flex-col">
        <Text className="text-small-semi text-ui-fg-base">
          {material.name || "Material"}
        </Text>
        {details.length > 0 && (
          <Text className="text-small text-ui-fg-muted">
            {details.join(" · ")}
          </Text>
        )}
      </div>
    </div>
  )
}
