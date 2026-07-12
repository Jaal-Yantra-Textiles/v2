import {
  Button,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { useCompany } from "../../../../hooks/api/companies-admin"
import { useUpdateCompanyCompliance } from "../../../../hooks/api/investor-financials-admin"

type LinkItem = { label: string; url: string }

const formatLinks = (links: unknown): string => {
  if (!Array.isArray(links)) return ""
  return links
    .map((l: any) => `${l?.label ?? ""} | ${l?.url ?? ""}`)
    .join("\n")
}

const parseLinks = (value: string): LinkItem[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("|")
      if (idx === -1) return { label: line.trim(), url: "" }
      return {
        label: line.slice(0, idx).trim(),
        url: line.slice(idx + 1).trim(),
      }
    })

const formatHighlights = (highlights: unknown): string =>
  Array.isArray(highlights) ? highlights.join("\n") : ""

const parseHighlights = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

const EditInvestorProfileForm = ({ companyId }: { companyId: string }) => {
  const { company } = useCompany(companyId)
  const { handleSuccess } = useRouteModal()
  const metadata = ((company as any)?.metadata ?? {}) as Record<string, any>

  const form = useForm({
    defaultValues: {
      tagline: metadata.tagline ?? "",
      github_url: metadata.github_url ?? "",
      pitch_deck_url: metadata.pitch_deck_url ?? "",
      highlights: formatHighlights(metadata.highlights),
      links: formatLinks(metadata.links),
    },
    values: {
      tagline: metadata.tagline ?? "",
      github_url: metadata.github_url ?? "",
      pitch_deck_url: metadata.pitch_deck_url ?? "",
      highlights: formatHighlights(metadata.highlights),
      links: formatLinks(metadata.links),
    },
  })

  const { mutateAsync, isPending } = useUpdateCompanyCompliance(companyId, {
    onSuccess: () => {
      toast.success("Investor profile updated")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to update"),
  })

  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      metadata: {
        ...((company as any)?.metadata || {}),
        tagline: v.tagline || null,
        github_url: v.github_url || null,
        pitch_deck_url: v.pitch_deck_url || null,
        highlights: parseHighlights(v.highlights),
        links: parseLinks(v.links),
      },
    })
  )

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Investor profile</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Tagline</Label>
          <Input {...form.register("tagline")} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">GitHub URL</Label>
          <Input {...form.register("github_url")} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Pitch deck URL</Label>
          <Input {...form.register("pitch_deck_url")} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Highlights</Label>
          <Textarea rows={4} {...form.register("highlights")} />
          <Text size="small" className="text-ui-fg-subtle">
            One highlight per line.
          </Text>
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Links</Label>
          <Textarea rows={4} {...form.register("links")} />
          <Text size="small" className="text-ui-fg-subtle">
            One link per line, formatted as{" "}
            <span className="font-mono">Label | https://url</span>.
          </Text>
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteDrawer.Close>
          <Button size="small" type="submit" isLoading={isPending}>Save</Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

const EditInvestorProfilePage = () => {
  const { id } = useParams()
  return (
    <RouteDrawer>
      <EditInvestorProfileForm companyId={id!} />
    </RouteDrawer>
  )
}

export default EditInvestorProfilePage
