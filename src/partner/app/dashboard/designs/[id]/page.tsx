import { Container, Heading, StatusBadge, Text, Button } from "@medusajs/ui"
import { redirect } from "next/navigation"
import { getPartnerDesign, partnerStartDesign, partnerFinishDesign, partnerRedoDesign, partnerCompleteDesign, partnerRefinishDesign } from "../../actions"

import MoodboardSection from "./sections/moodboard-section"
import SpecsSection from "./sections/specs-section"
import NotesSection from "./sections/notes-section"
import MediaSection from "./sections/media-section"
import ActionFooter from "../../../components/action-footer/action-footer"
import ActionFormButton from "../../../components/action-footer/action-form-button"
import { getAuthCookie } from "../../../../lib/auth-cookie"

interface PageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

export const dynamic = "force-dynamic"

export default async function DesignDetailsPage({ params, searchParams }: PageProps) {
  const { id } = await params
  type SP = { [key: string]: string | string[] | undefined }
  const sp = ((await (searchParams || Promise.resolve({} as SP))) || {}) as SP
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

  // Upload + attach media in one step for partners
  async function uploadAndAttachMedia(formData: FormData) {
    "use server"
    try {
      const token = await getAuthCookie()
      if (!token) redirect("/login")
      const MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"

      // 1) Forward files to partner media upload endpoint with size/type guard
      const files = formData.getAll("files") as unknown as File[]
      if (!files || files.length === 0) {
        redirect(`/dashboard/designs/${id}?error=${encodeURIComponent("Please select at least one file.")}`)
      }

      // Guard: max 25 MB per file, basic type allow-list (image/*, video/*)
      const MAX_BYTES = 25 * 1024 * 1024
      const allowedPrefixes = ["image/", "video/"]
      for (const f of files) {
        if (f.size > MAX_BYTES) {
          redirect(`/dashboard/designs/${id}?error=${encodeURIComponent(`File ${f.name} exceeds 25MB limit`)}`)
        }
        if (!allowedPrefixes.some((p) => f.type?.startsWith(p))) {
          redirect(`/dashboard/designs/${id}?error=${encodeURIComponent(`Unsupported file type for ${f.name}`)}`)
        }
      }

      const fd = new FormData()
      for (const f of files) fd.append("files", f)

      const uploadRes = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${id}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
        cache: "no-store",
      })
      if (!uploadRes.ok) {
        throw new Error((await uploadRes.text()) || "Failed to upload media")
      }
      const { files: uploaded } = (await uploadRes.json()) as { files: Array<{ url: string; id?: string }> }
      if (!uploaded || !uploaded.length) {
        redirect(`/dashboard/designs/${id}?error=${encodeURIComponent("Upload did not return any files.")}`)
      }

      // 2) Attach URLs to the design, optionally set first as thumbnail
      const setThumb = formData.get("setThumbnail") === "1"
      const media_files = uploaded.map((f, i) => ({ url: f.url, isThumbnail: setThumb && i === 0 }))
      const attachRes = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${id}/media/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ media_files }),
        cache: "no-store",
      })
      if (!attachRes.ok) {
        throw new Error((await attachRes.text()) || "Failed to attach media")
      }
      redirect(`/dashboard/designs/${id}`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred while uploading media"
      redirect(`/dashboard/designs/${id}?error=${encodeURIComponent(msg)}`)
    }
  }

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
          <MediaSection thumbnailUrl={design.thumbnail_url} mediaFiles={design.media_files} designFiles={design.design_files} />
          <MoodboardSection moodboard={design.moodboard} />
        </section>

        {/* Partner media upload */}
        <section className="mb-8">
          <Heading level="h3" className="mb-2">Upload Media</Heading>
          {(() => {
            const err = Array.isArray(sp.error) ? sp.error[0] : sp.error
            return typeof err === "string" && err ? (
              <Text size="small" className="text-ui-fg-error mb-2">{err}</Text>
            ) : null
          })()}
          <form action={uploadAndAttachMedia} encType="multipart/form-data" className="flex items-center gap-3">
            <input type="file" name="files" multiple className="text-sm" accept="image/*,video/*" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="setThumbnail" value="1" />
              Set first as thumbnail
            </label>
            <Button type="submit" size="small" variant="secondary">Upload & Attach</Button>
          </form>
          <Text size="xsmall" className="text-ui-fg-subtle mt-1 block">Supported: images/videos as configured by storage provider.</Text>
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
