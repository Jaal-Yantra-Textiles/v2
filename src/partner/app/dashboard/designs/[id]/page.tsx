import { Button, Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { redirect } from "next/navigation"
import { getPartnerDesign, partnerStartDesign, partnerFinishDesign, partnerRedoDesign, partnerRefinishDesign } from "../../actions"

import MoodboardSection from "./sections/moodboard-section"
import SpecsSection from "./sections/specs-section"
import NotesSection from "./sections/notes-section"
import MediaSection from "./sections/media-section"
import ActionFooter from "../../../components/action-footer/action-footer"
import ActionFormButton from "../../../components/action-footer/action-form-button"
import CompleteDesignModal from "../../../components/complete-design-modal"
 

interface PageProps {
  params: Promise<{ id: string }>
}

export const dynamic = "force-dynamic"

export default async function DesignDetailsPage({ params }: PageProps) {
  const { id } = await params
  const design = await getPartnerDesign(id)
  if (!design) {
    redirect("/dashboard/designs")
  }

  type LinkedItem = {
    id: string
    title?: string | null
    raw_materials?: { name?: string | null } | null
    location_levels?: Array<{
      stocked_quantity?: number
      available_quantity?: number
      stock_locations?: Array<{ id: string; name?: string | null }>
    }>
  }
  const linkedItems: LinkedItem[] = Array.isArray((design as { inventory_items?: unknown[] })?.inventory_items)
    ? (((design as { inventory_items?: LinkedItem[] }).inventory_items as LinkedItem[]) || [])
    : []

  type PartnerStatus = "incoming" | "assigned" | "in_progress" | "finished" | "completed"
  const partnerStatusRaw = design?.partner_info?.partner_status as string | undefined
  const normalizeStatus = (s?: string): PartnerStatus => {
    if (!s) return "assigned"
    if (s === "started") return "in_progress"
    if (["incoming", "assigned", "in_progress", "finished", "completed"].includes(s)) return s as PartnerStatus
    return "assigned"
  }
  const partnerStatus: PartnerStatus = normalizeStatus(partnerStatusRaw)
  const isRedoPhase = design?.partner_info?.partner_phase === "redo"
  const shortId = design.id && design.id.length > 12 ? `${design.id.slice(0, 10)}…${design.id.slice(-4)}` : design.id

  async function startDesign() {
    "use server"
    await partnerStartDesign(id)
    redirect(`/dashboard/designs/${id}`)
  }

  async function finishDesign() {
    "use server"
    await partnerFinishDesign(id)
    redirect(`/dashboard/designs/${id}`)
  }

  async function refinishDesign() {
    "use server"
    await partnerRefinishDesign(id)
    redirect(`/dashboard/designs/${id}`)
  }

  async function requestRedo(formData: FormData) {
    "use server"
    await partnerRedoDesign(id, formData)
    redirect(`/dashboard/designs/${id}`)
  }

  // Modal-completion handler: optionally accepts consumptions JSON and completes
  async function completeWithInventory(formData: FormData) {
    "use server"
    const consumptionsRaw = formData.get("consumptions")
    try {
      if (typeof consumptionsRaw === "string" && consumptionsRaw.length) {
        const parsed = JSON.parse(consumptionsRaw) as Array<{ inventory_item_id: string; quantity?: number; location_id?: string }>
        await (await import("../../actions")).partnerCompleteDesignWithConsumptions(id, parsed)
      } else {
        await (await import("../../actions")).partnerCompleteDesign(id)
      }
    } catch (error) {
      // Re-throw redirect errors (Next.js NEXT_REDIRECT)
      if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) {
        throw error
      }
      // For other errors, fallback to simple complete
      await (await import("../../actions")).partnerCompleteDesign(id)
    }
    redirect(`/dashboard/designs/${id}`)
  }

  // Upload is handled client-side within MediaSection to avoid full page reloads

  return (
    <>
      <Container className="py-6 p-4 pb-24 w-full !max-w-none">
        {/* Header */}
        <section aria-labelledby="design-header" className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <Heading id="design-header" level="h2" title={design.name || design.id} className="truncate">
              {design.name || `Design ${shortId}`}
            </Heading>
            <Text size="small" className="text-ui-fg-subtle truncate">ID: {shortId}</Text>
          </div>
          <div className="flex items-center gap-2 md:self-auto self-start">
            <StatusBadge color={design.status === "completed" || design.status === "Approved" ? "green" : design.status === "in_progress" || design.status === "In_Development" || design.status === "Revision" ? "orange" : "blue"}>
              {design.status}
            </StatusBadge>
            <StatusBadge color={partnerStatus === "completed" ? "green" : partnerStatus === "in_progress" || partnerStatus === "finished" ? "orange" : "blue"}>
              {partnerStatus}
            </StatusBadge>
          </div>
        </section>

        {/* Partner workflow steps indicator (Start -> Finish -> Redo -> Complete) */}
        <section className="mb-6">
          <div className="flex flex-col gap-2">
            <Heading level="h3">Partner workflow</Heading>
            <div className="flex items-center justify-center gap-4 flex-wrap w-full">
              {/* Start */}
              <div className="flex items-center gap-2">
                <div className={`size-3 rounded-full ${partnerStatus === "in_progress" || partnerStatus === "finished" || partnerStatus === "completed" ? "bg-ui-tag-green-icon" : "bg-ui-fg-muted"}`} />
                <Text size="small">Start</Text>
              </div>
              {design.partner_info?.partner_started_at && (
                <Text size="xsmall" className="text-ui-fg-subtle">{new Date(design.partner_info.partner_started_at).toLocaleString()}</Text>
              )}
              <div className="h-0.5 w-10 border-t-2 border-dashed border-ui-border" />

              {/* Finish */}
              <div className="flex items-center gap-2">
                <div className={`size-3 rounded-full ${partnerStatus === "finished" || partnerStatus === "completed" ? "bg-ui-tag-green-icon" : "bg-ui-fg-muted"}`} />
                <Text size="small">Finish</Text>
              </div>
              {design.partner_info?.partner_finished_at && (
                <Text size="xsmall" className="text-ui-fg-subtle">{new Date(design.partner_info.partner_finished_at).toLocaleString()}</Text>
              )}
              <div className="h-0.5 w-10 border-t-2 border-dashed border-ui-border" />

              {/* Redo (optional phase after Finish) */}
              <div className="flex items-center gap-2">
                <div className={`size-3 rounded-full ${design.partner_info?.partner_phase === "redo" ? "bg-ui-tag-orange-icon" : "bg-ui-fg-muted"}`} />
                <Text size="small">Redo</Text>
              </div>
              <div className="h-0.5 w-10 border-t-2 border-dashed border-ui-border" />

              {/* Complete */}
              <div className="flex items-center gap-2">
                <div className={`size-3 rounded-full ${partnerStatus === "completed" ? "bg-ui-tag-green-icon" : "bg-ui-fg-muted"}`} />
                <Text size="small">Complete</Text>
              </div>
              {design.partner_info?.partner_completed_at && (
                <Text size="xsmall" className="text-ui-fg-subtle">{new Date(design.partner_info.partner_completed_at).toLocaleString()}</Text>
              )}
            </div>
          </div>
        </section>

        {/* Redo subtasks progress (visible only when in redo phase) */}
        {isRedoPhase && (
          <section className="mb-6">
            <div className="flex flex-col gap-2">
              <Heading level="h3">Redo cycle progress</Heading>
              <div className="flex items-center gap-4 flex-wrap">
                {(() => {
                  type TaskLite = { title?: string; status?: "pending" | "in_progress" | "completed" | "cancelled" | "accepted" }
                  const tasks: TaskLite[] = Array.isArray((design as { tasks?: TaskLite[] })?.tasks)
                    ? ((design as { tasks?: TaskLite[] }).tasks as TaskLite[])
                    : []
                  const findTask = (title: string) => tasks.find((t) => t?.title === title)
                  const badge = (title: string, label: string) => {
                    const t = findTask(title)
                    const s: TaskLite["status"] = t?.status || "pending"
                    const color: "green" | "orange" | "blue" = s === "completed" ? "green" : s === "in_progress" ? "orange" : "blue"
                    return (
                      <div className="flex items-center gap-2" key={title}>
                        <StatusBadge color={color}>{label}: {s}</StatusBadge>
                      </div>
                    )
                  }
                  return (
                    <>
                      {badge("partner-design-redo-log", "Redo Log")}
                      {badge("partner-design-redo-apply", "Redo Apply")}
                      {badge("partner-design-redo-verify", "Redo Verify")}
                    </>
                  )
                })()}
              </div>
            </div>
          </section>
        )}

        {/* Media and Moodboard grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <MediaSection
            designId={design.id}
            thumbnailUrl={design.thumbnail_url}
            mediaFiles={design.media_files}
            designFiles={design.design_files}
          />
          <MoodboardSection moodboard={design.moodboard} />
        </section>

        {/* Specs and Notes */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <SpecsSection sizes={design.custom_sizes} colors={design.color_palette} tags={design.tags} inspiration={design.inspiration_sources} estimatedCost={design.estimated_cost ?? design.raw_estimated_cost?.value} />
          </div>
          <div className="lg:col-span-1">
            <NotesSection designerNotes={design.designer_notes} />
          </div>
        </section>

        {/* Inventory in use (linked inventory overview) */}
        {linkedItems.length > 0 && (
          <section className="mt-8">
            <div className="flex flex-col gap-3">
              <Heading level="h3">Inventory in use</Heading>
              <div className="rounded-md border border-ui-border-subtle divide-y">
                {linkedItems.map((it) => {
                  const lvl = it.location_levels && it.location_levels.length ? it.location_levels[0] : undefined
                  const firstLoc = lvl?.stock_locations && lvl.stock_locations.length ? lvl.stock_locations[0] : undefined
                  const locLabel = firstLoc?.name || firstLoc?.id || "—"
                  return (
                    <div key={it.id} className="grid grid-cols-12 gap-2 p-3 items-center">
                      <div className="col-span-6">
                        <div className="font-medium truncate">{it.title || it.id}</div>
                        <div className="text-ui-fg-subtle text-xs truncate">{it.raw_materials?.name || "Raw material"}</div>
                      </div>
                      <div className="col-span-6 text-right">
                        <div className="text-xs text-ui-fg-subtle">Location</div>
                        <div className="text-sm truncate">{locLabel}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Specify the quantities to consume when you click Complete.
              </Text>
            </div>
          </section>
        )}
      </Container>

      <ActionFooter>
        {partnerStatus === "assigned" && (
          <ActionFormButton fullWidth action={startDesign}>Start</ActionFormButton>
        )}

        {(partnerStatus === "in_progress" || isRedoPhase) && (
          <ActionFormButton fullWidth action={isRedoPhase ? refinishDesign : finishDesign}>{isRedoPhase ? "Re-Finish" : "Finish"}</ActionFormButton>
        )}

        {partnerStatus === "finished" && !isRedoPhase && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full">
            {/* Request Redo as a distinct, less prominent action */}
            <form action={requestRedo} className="flex items-center gap-2 w-full sm:w-auto">
              <input name="notes" placeholder="Reason to redo" className="border rounded px-2 py-1 text-sm flex-1" />
              <Button className="w-full sm:w-auto" type="submit" variant="secondary" size="base">Request Redo</Button>
            </form>
            {/* Complete via modal that asks for inventory used */}
            <CompleteDesignModal completeAction={completeWithInventory} items={linkedItems} />
          </div>
        )}

        {partnerStatus === "completed" && (
          <div className="w-full text-center">
            <Text size="small" className="text-ui-fg-subtle">
              All set. We’ll reach out if anything else is needed.
            </Text>
          </div>
        )}
      </ActionFooter>
    </>
  )
}
