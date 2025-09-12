import { Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { redirect } from "next/navigation"
import { getPartnerDesign, partnerStartDesign, partnerFinishDesign, partnerRedoDesign, partnerCompleteDesign, partnerRefinishDesign } from "../../actions"

import MoodboardSection from "./sections/moodboard-section"
import SpecsSection from "./sections/specs-section"
import NotesSection from "./sections/notes-section"
import MediaSection from "./sections/media-section"
import ActionFooter from "../../../components/action-footer/action-footer"
import ActionFormButton from "../../../components/action-footer/action-form-button"
 

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

  const partnerStatus: "incoming" | "assigned" | "in_progress" | "finished" | "completed" = (design?.partner_info?.partner_status) ?? "assigned"
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

  async function completeDesign() {
    "use server"
    await partnerCompleteDesign(id)
    redirect(`/dashboard/designs/${id}`)
  }

  // Upload is handled client-side within MediaSection to avoid full page reloads

  return (
    <>
      <Container className="py-6 p-4 w-full !max-w-none">
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
      </Container>

      <ActionFooter>
        {partnerStatus === "assigned" && (
          <ActionFormButton action={startDesign}>Start</ActionFormButton>
        )}

        {(partnerStatus === "in_progress" || isRedoPhase) && (
          <ActionFormButton action={isRedoPhase ? refinishDesign : finishDesign}>{isRedoPhase ? "Re-Finish" : "Finish"}</ActionFormButton>
        )}

        {partnerStatus === "finished" && !isRedoPhase && (
          <>
            {/* Redo request after Finish */}
            <form action={requestRedo} className="flex items-center gap-2">
              <input name="notes" placeholder="Reason to redo" className="border rounded px-2 py-1 text-sm" />
              <button type="submit" className="btn btn-secondary px-3 py-1 rounded text-sm">Request Redo</button>
            </form>
            <ActionFormButton action={completeDesign}>Complete</ActionFormButton>
          </>
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
